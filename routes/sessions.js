const express = require('express');
const { Op } = require('sequelize');
const { Session, Cohort, Program, Enrollment, Attendance, User, Recording } = require('../models');
const { requireAuth, noImpersonation } = require('../middleware/guards');
const { windowFor, recordJoin } = require('../services/sessions');
const { fmtDate } = require('../utils/format');

const router = express.Router();
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v));
const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

// Loads the session and the signed-in student's enrollment. Returns null after answering when access is not allowed.
async function loadForStudent(req, res) {
  if (!isUuid(req.params.id)) {
    res.status(404).render('errors/404', { title: 'Not found' });
    return null;
  }
  const session = await Session.findByPk(req.params.id, { include: [{ model: Cohort, include: [Program] }, { model: User, as: 'lead', attributes: ['name'] }] });
  if (!session) {
    res.status(404).render('errors/404', { title: 'Not found' });
    return null;
  }
  const cohort = session.Cohort;
  const enrollment = await Enrollment.findOne({ where: { cohortId: cohort.id, userId: req.user.id, status: { [Op.in]: ['active', 'completed', 'suspended'] } } });
  if (!enrollment) {
    req.flash('info', 'Enroll in this cohort to open its sessions.');
    res.redirect(`/programs/${cohort.Program.slug}`);
    return null;
  }
  if (enrollment.status === 'suspended' || cohort.status === 'suspended' || cohort.Program.status === 'suspended') {
    res.status(403).render('errors/suspended', { title: 'Access paused' });
    return null;
  }
  return { session, cohort, enrollment };
}

router.get('/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    const ctx = await loadForStudent(req, res);
    if (!ctx) return;
    const { session, cohort } = ctx;
    const attendance = await Attendance.findOne({ where: { sessionId: session.id, userId: req.user.id } });
    const recording = await Recording.findOne({ where: { sessionId: session.id, status: 'published' }, order: [['sortOrder', 'ASC']] });
    const win = windowFor(session);
    const tz = req.user.timezone;
    const sameDay = (a, b) => fmtDate(a, tz) === fmtDate(b, tz);
    res.render('sessions/show', {
      title: session.title,
      session,
      cohort,
      win,
      attendance,
      recording,
      hasLink: Boolean(session.meetLink),
      isToday: win.start ? sameDay(win.start, new Date()) : false,
    });
  } catch (err) {
    next(err);
  }
});

// The only way into the meeting. Pressing Join records attendance, then sends the student to the pasted link.
router.post('/sessions/:id/join', requireAuth, noImpersonation, async (req, res, next) => {
  try {
    const ctx = await loadForStudent(req, res);
    if (!ctx) return;
    const { session } = ctx;
    const back = `/sessions/${session.id}`;
    const win = windowFor(session);
    if (win.state === 'cancelled') {
      req.flash('error', 'This session was cancelled.');
      return res.redirect(back);
    }
    if (win.state === 'upcoming') {
      req.flash('info', 'Joining is not open yet. The button works shortly before the start.');
      return res.redirect(back);
    }
    if (win.state === 'ended') {
      req.flash('info', 'This session has ended.');
      return res.redirect(back);
    }
    if (!session.meetLink) {
      req.flash('error', 'The meeting link has not been added yet. Please try again in a few minutes.');
      return res.redirect(back);
    }
    await recordJoin(session, req.user, req);
    return res.redirect(session.meetLink);
  } catch (err) {
    return next(err);
  }
});

const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// "Add to calendar". It carries the session page address, never the meeting link.
router.get('/sessions/:id/calendar.ics', requireAuth, async (req, res, next) => {
  try {
    const ctx = await loadForStudent(req, res);
    if (!ctx) return;
    const { session, cohort } = ctx;
    const url = `${appUrl()}/sessions/${session.id}`;
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//True Series Academy//Sessions//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${session.id}@trueseries`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(session.startsAt)}`,
      `DTEND:${icsDate(session.endsAt)}`,
      `SUMMARY:${icsText(`${session.title} (${cohort.Program.title})`)}`,
      `DESCRIPTION:${icsText(`Open the session page and press Join so your attendance is recorded.\n${url}`)}`,
      `URL:${url}`,
      'END:VEVENT', 'END:VCALENDAR',
    ];
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="session.ics"' });
    return res.send(lines.join('\r\n'));
  } catch (err) {
    return next(err);
  }
});

// ---------- Account (name, time zone, reminders) ----------
const ZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Africa/Lagos', 'UTC'];
const zoneList = () => ['Africa/Lagos', ...ZONES.filter((z) => z !== 'Africa/Lagos')];

router.get('/account', requireAuth, (req, res) => {
  res.render('account/index', { title: 'Your account', zones: zoneList(), errors: [], form: null });
});

router.post('/account', requireAuth, noImpersonation, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const timezone = String(req.body.timezone || '');
    const errors = [];
    if (name.length < 2 || name.length > 80) errors.push('Enter your full name.');
    if (!zoneList().includes(timezone)) errors.push('Choose a time zone from the list.');
    if (errors.length) return res.status(400).render('account/index', { title: 'Your account', zones: zoneList(), errors, form: { name, timezone, reminderEmails: req.body.reminderEmails === 'on' } });
    req.user.name = name;
    req.user.timezone = timezone;
    req.user.timezoneConfirmed = true;
    req.user.reminderEmails = req.body.reminderEmails === 'on';
    await req.user.save();
    req.flash('success', 'Your account is updated.');
    return res.redirect('/account');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
