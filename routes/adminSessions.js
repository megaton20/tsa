const express = require('express');
const { Op, fn } = require('sequelize');
const { Session, Attendance, Enrollment, ProgramStaff, Role, User } = require('../models');
const { requireAuth, requireAdminAccess } = require('../middleware/guards');
const { verifyCsrf } = require('../middleware/csrf');
const { loadCohort, loadSession, need, deny } = require('../middleware/adminLoaders');
const { canProgram } = require('../utils/permissions');
const { audit } = require('../services/audit');
const { cohortAttendance, windowFor, ENROLLED } = require('../services/sessions');
const { visibleTasks, resolveTask } = require('../services/tasks');
const { fromLagosInput, isMeetingLink, csvCell, fmtWhen } = require('../utils/format');

const router = express.Router();
router.use(requireAuth, requireAdminAccess);
const WEEK = 7 * 24 * 60 * 60 * 1000;

const leadCandidates = async (programId) => {
  const rows = await ProgramStaff.findAll({ where: { programId }, include: [User, Role] });
  return rows.filter((r) => (r.Role.permissions || []).includes('sessions.manage')).map((r) => r.User);
};

// ---------- Sessions of a cohort ----------
router.get('/cohorts/:cohortId/sessions', loadCohort, async (req, res, next) => {
  try {
    if (!canProgram(req.user, 'sessions.manage', req.program.id) && !canProgram(req.user, 'attendance.view', req.program.id)) return deny(res);
    const sessions = await Session.findAll({ where: { cohortId: req.cohort.id }, include: [{ model: User, as: 'lead', attributes: ['name'] }], order: [['startsAt', 'ASC']] });
    const counts = {};
    if (sessions.length) {
      const rows = await Attendance.findAll({ attributes: ['sessionId', [fn('COUNT', '*'), 'n']], where: { sessionId: sessions.map((s) => s.id) }, group: ['sessionId'], raw: true });
      rows.forEach((r) => (counts[r.sessionId] = Number(r.n)));
    }
    const enrolled = await Enrollment.count({ where: { cohortId: req.cohort.id, status: { [Op.in]: ENROLLED } } });
    const now = new Date();
    const items = sessions.map((s) => ({ session: s, win: windowFor(s, now), joined: counts[s.id] || 0 }));
    res.render('admin/sessions/index', {
      title: `Sessions: ${req.cohort.name}`, active: 'programs', enrolled,
      upcoming: items.filter((i) => new Date(i.session.endsAt) >= now),
      past: items.filter((i) => new Date(i.session.endsAt) < now).reverse(),
    });
  } catch (err) {
    next(err);
  }
});

function parseSession(b) {
  const errors = [];
  const startsAt = fromLagosInput(b.startsAt);
  const duration = parseInt(b.durationMinutes, 10);
  const opens = b.joinOpensMinutesBefore === '' || b.joinOpensMinutesBefore === undefined ? 15 : parseInt(b.joinOpensMinutesBefore, 10);
  const link = String(b.meetLink || '').trim();
  const data = {
    title: String(b.title || '').trim().slice(0, 160),
    description: String(b.description || '').trim().slice(0, 4000) || null,
    startsAt,
    durationMinutes: duration,
    joinOpensMinutesBefore: opens,
    meetLink: link || null,
    leadId: /^[0-9a-f-]{36}$/i.test(String(b.leadId || '')) ? b.leadId : null,
  };
  if (data.title.length < 3) errors.push('Give the session a title.');
  if (!startsAt) errors.push('Choose the start date and time.');
  if (!(duration >= 15 && duration <= 600)) errors.push('Length must be between 15 and 600 minutes.');
  if (!(opens >= 0 && opens <= 180)) errors.push('Joining can open between 0 and 180 minutes before the start.');
  if (link && !isMeetingLink(link)) errors.push('Paste a Google Meet or Zoom link that starts with https://');
  return { data, errors };
}

const blank = { joinOpensMinutesBefore: 15, durationMinutes: 90 };

router.get('/cohorts/:cohortId/sessions/new', loadCohort, need('sessions.manage'), async (req, res, next) => {
  try {
    res.render('admin/sessions/form', { title: 'New session', active: 'programs', s: blank, errors: [], isNew: true, leads: await leadCandidates(req.program.id) });
  } catch (err) {
    next(err);
  }
});

router.post('/cohorts/:cohortId/sessions', loadCohort, need('sessions.manage'), async (req, res, next) => {
  try {
    const { data, errors } = parseSession(req.body);
    const weeks = Math.min(Math.max(parseInt(req.body.repeatWeeks, 10) || 1, 1), 26);
    if (errors.length) return res.status(400).render('admin/sessions/form', { title: 'New session', active: 'programs', s: { ...data, startsAt: data.startsAt }, errors, isNew: true, leads: await leadCandidates(req.program.id) });
    const rows = [];
    for (let i = 0; i < weeks; i += 1) {
      const start = new Date(data.startsAt.getTime() + i * WEEK);
      rows.push({
        cohortId: req.cohort.id,
        title: weeks > 1 ? `${data.title} (Week ${i + 1})` : data.title,
        description: data.description,
        startsAt: start,
        endsAt: new Date(start.getTime() + data.durationMinutes * 60 * 1000),
        meetLink: data.meetLink,
        joinOpensMinutesBefore: data.joinOpensMinutesBefore,
        leadId: data.leadId,
      });
    }
    await Session.bulkCreate(rows);
    await audit(req, 'session.create', 'Cohort', req.cohort.id, { title: data.title, count: rows.length });
    req.flash('success', rows.length > 1 ? `${rows.length} weekly sessions scheduled.` : 'Session scheduled.');
    return res.redirect(`/admin/cohorts/${req.cohort.id}/sessions`);
  } catch (err) {
    return next(err);
  }
});

router.get('/sessions/:sessionId/edit', loadSession, need('sessions.manage'), async (req, res, next) => {
  try {
    const s = req.session_;
    res.render('admin/sessions/form', {
      title: 'Edit session', active: 'programs', isNew: false, errors: [], leads: await leadCandidates(req.program.id),
      s: { id: s.id, title: s.title, description: s.description, startsAt: s.startsAt, durationMinutes: Math.round((new Date(s.endsAt) - new Date(s.startsAt)) / 60000), joinOpensMinutesBefore: s.joinOpensMinutesBefore, meetLink: s.meetLink, leadId: s.leadId },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/sessions/:sessionId', loadSession, need('sessions.manage'), async (req, res, next) => {
  try {
    const s = req.session_;
    const { data, errors } = parseSession(req.body);
    if (errors.length) return res.status(400).render('admin/sessions/form', { title: 'Edit session', active: 'programs', isNew: false, errors, leads: await leadCandidates(req.program.id), s: { ...data, id: s.id } });
    const startChanged = new Date(s.startsAt).getTime() !== data.startsAt.getTime();
    await s.update({
      title: data.title,
      description: data.description,
      startsAt: data.startsAt,
      endsAt: new Date(data.startsAt.getTime() + data.durationMinutes * 60 * 1000),
      meetLink: data.meetLink,
      joinOpensMinutesBefore: data.joinOpensMinutesBefore,
      leadId: data.leadId,
      // A moved session gets its reminders again
      ...(startChanged ? { remindedDayAt: null, remindedHourAt: null } : {}),
    });
    if (data.meetLink) await resolveTask(`meet:${s.id}`);
    await audit(req, 'session.update', 'Session', s.id, { title: data.title });
    req.flash('success', 'Session saved.');
    return res.redirect(`/admin/cohorts/${s.cohortId}/sessions`);
  } catch (err) {
    return next(err);
  }
});

// Quick "paste the link" from the list
router.post('/sessions/:sessionId/link', loadSession, need('sessions.manage'), async (req, res, next) => {
  try {
    const s = req.session_;
    const link = String(req.body.meetLink || '').trim();
    if (!isMeetingLink(link)) {
      req.flash('error', 'Paste a Google Meet or Zoom link that starts with https://');
      return res.redirect(`/admin/cohorts/${s.cohortId}/sessions`);
    }
    await s.update({ meetLink: link });
    await resolveTask(`meet:${s.id}`);
    await audit(req, 'session.link', 'Session', s.id, { title: s.title });
    req.flash('success', 'Meeting link saved.');
    return res.redirect(`/admin/cohorts/${s.cohortId}/sessions`);
  } catch (err) {
    return next(err);
  }
});

router.post('/sessions/:sessionId/cancel', loadSession, need('sessions.manage'), async (req, res, next) => {
  try {
    const s = req.session_;
    s.status = s.status === 'cancelled' ? 'scheduled' : 'cancelled';
    await s.save();
    await audit(req, s.status === 'cancelled' ? 'session.cancel' : 'session.restore', 'Session', s.id, { title: s.title });
    req.flash('success', s.status === 'cancelled' ? 'Session cancelled. It no longer counts toward attendance.' : 'Session restored.');
    return res.redirect(`/admin/cohorts/${s.cohortId}/sessions`);
  } catch (err) {
    return next(err);
  }
});

router.post('/sessions/:sessionId/delete', loadSession, need('sessions.manage'), async (req, res, next) => {
  try {
    const s = req.session_;
    if (await Attendance.count({ where: { sessionId: s.id } })) {
      req.flash('error', 'Someone already joined this session, so it cannot be deleted. Cancel it instead.');
      return res.redirect(`/admin/cohorts/${s.cohortId}/sessions`);
    }
    await s.destroy();
    await resolveTask(`meet:${s.id}`);
    await audit(req, 'session.delete', 'Session', s.id, { title: s.title });
    req.flash('success', 'Session deleted.');
    return res.redirect(`/admin/cohorts/${s.cohortId}/sessions`);
  } catch (err) {
    return next(err);
  }
});

// ---------- Attendance: who pressed Join (used to decide who to let in) ----------
router.get('/sessions/:sessionId/attendance', loadSession, need('attendance.view'), async (req, res, next) => {
  try {
    const s = req.session_;
    const q = String(req.query.q || '').trim().toLowerCase();
    const [enrollments, marks] = await Promise.all([
      Enrollment.findAll({ where: { cohortId: s.cohortId, status: { [Op.in]: ENROLLED } }, include: [User] }),
      Attendance.findAll({ where: { sessionId: s.id } }),
    ]);
    const byUser = {};
    marks.forEach((m) => (byUser[m.userId] = m));
    let rows = enrollments.map((e) => ({ enrollment: e, user: e.User, mark: byUser[e.userId] || null }));
    if (q) rows = rows.filter((r) => r.user.name.toLowerCase().includes(q) || r.user.email.toLowerCase().includes(q));
    // Joined first (earliest on top), then everyone else by name
    rows.sort((a, b) => {
      if (a.mark && b.mark) return new Date(a.mark.firstJoinedAt || a.mark.createdAt) - new Date(b.mark.firstJoinedAt || b.mark.createdAt);
      if (a.mark) return -1;
      if (b.mark) return 1;
      return a.user.name.localeCompare(b.user.name);
    });
    const win = windowFor(s);
    res.render('admin/sessions/attendance', {
      title: `Attendance: ${s.title}`, active: 'programs', rows, q, win,
      joined: marks.length, total: enrollments.length, live: win.state === 'open' || (win.state === 'upcoming' && win.opens - new Date() < 30 * 60 * 1000),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/sessions/:sessionId/attendance/mark', loadSession, need('attendance.manage'), async (req, res, next) => {
  try {
    const s = req.session_;
    const back = `/admin/sessions/${s.id}/attendance`;
    const userId = String(req.body.userId || '');
    const enrolled = await Enrollment.findOne({ where: { cohortId: s.cohortId, userId, status: { [Op.in]: ENROLLED } }, include: [User] });
    if (!enrolled) return res.redirect(back);
    if (req.body.action === 'clear') {
      await Attendance.destroy({ where: { sessionId: s.id, userId, method: 'manual' } });
      await audit(req, 'attendance.clear', 'Session', s.id, { student: enrolled.User.email });
      req.flash('success', 'Manual mark removed.');
      return res.redirect(back);
    }
    const note = String(req.body.note || '').trim().slice(0, 255);
    if (note.length < 3) {
      req.flash('error', 'Add a short reason for marking someone present by hand.');
      return res.redirect(back);
    }
    const now = new Date();
    await Attendance.findOrCreate({
      where: { sessionId: s.id, userId },
      defaults: { method: 'manual', firstJoinedAt: now, lastJoinedAt: now, joinCount: 0, markedById: (req.actor || req.user).id, note },
    });
    await audit(req, 'attendance.mark', 'Session', s.id, { student: enrolled.User.email, note });
    req.flash('success', `${enrolled.User.name} is marked present.`);
    return res.redirect(back);
  } catch (err) {
    return next(err);
  }
});

// ---------- Whole-cohort attendance ----------
router.get('/cohorts/:cohortId/attendance', loadCohort, need('attendance.view'), async (req, res, next) => {
  try {
    const data = await cohortAttendance(req.cohort.id);
    res.render('admin/sessions/matrix', { title: `Attendance: ${req.cohort.name}`, active: 'programs', ...data, required: req.cohort.attendanceRequiredPercent });
  } catch (err) {
    next(err);
  }
});

router.get('/cohorts/:cohortId/attendance.csv', loadCohort, need('attendance.view'), async (req, res, next) => {
  try {
    const { sessions, held, students } = await cohortAttendance(req.cohort.id);
    const head = ['Name', 'Email', ...sessions.map((s) => `${s.title} (${fmtWhen(s.startsAt)})`), 'Attended', 'Sessions held', 'Attendance %'];
    const lines = [head.map(csvCell).join(',')];
    const heldIds = new Set(held.map((s) => s.id));
    students.forEach((st) => {
      lines.push([st.user.name, st.user.email, ...sessions.map((s) => (st.marks[s.id] ? 'Present' : heldIds.has(s.id) ? 'Absent' : '')), st.attended, held.length, st.percent === null ? '' : st.percent].map(csvCell).join(','));
    });
    await audit(req, 'attendance.export', 'Cohort', req.cohort.id, { rows: students.length });
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="attendance-${req.cohort.id.slice(0, 8)}.csv"` });
    return res.send(`\uFEFF${lines.join('\r\n')}`);
  } catch (err) {
    return next(err);
  }
});

// ---------- Tasks the system noticed ----------
router.get('/tasks', async (req, res, next) => {
  try {
    const tasks = await visibleTasks(req.user);
    res.render('admin/tasks', { title: 'Needs attention', active: 'tasks', tasks, now: new Date() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
