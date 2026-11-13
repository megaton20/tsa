const express = require('express');
const { Op, fn } = require('sequelize');
const { Program, Cohort, ProgramStaff, QuizQuestion, Application, Enrollment, Payment, User, Role, Session } = require('../models');
const { requireAuth, requireAdminAccess } = require('../middleware/guards');
const { verifyCsrf } = require('../middleware/csrf');
const { imageUpload } = require('../middleware/upload');
const { hasPermission, canProgram } = require('../utils/permissions');
const { audit } = require('../services/audit');
const enroll = require('../services/enrollment');
const mailer = require('../services/mailer');
const { fromLagosInput, isHttps, isSafeUrl, slugify, nairaToKobo, naira } = require('../utils/format');
const { payableKobo } = require('../utils/cohort');
const { issueForCohort } = require('../services/certificates');
const { statsFor } = require('../services/levels');

const { deny, notFound, loadProgram, loadCohort, need, needGlobal } = require('../middleware/adminLoaders');

const router = express.Router();
router.use(requireAuth, requireAdminAccess);

const banners = imageUpload('programs');
const escLike = (s) => s.replace(/[\\%_]/g, '\\$&');
const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

function paginate(req, perPage = 25) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  return { page, limit: perPage, offset: (page - 1) * perPage };
}

async function countsByCohort(cohortIds) {
  const out = {};
  cohortIds.forEach((id) => (out[id] = { apps: {}, enr: {} }));
  if (!cohortIds.length) return out;
  const [apps, enrs] = await Promise.all([
    Application.findAll({ attributes: ['cohortId', 'status', [fn('COUNT', '*'), 'n']], where: { cohortId: cohortIds }, group: ['cohortId', 'status'], raw: true }),
    Enrollment.findAll({ attributes: ['cohortId', 'status', [fn('COUNT', '*'), 'n']], where: { cohortId: cohortIds }, group: ['cohortId', 'status'], raw: true }),
  ]);
  apps.forEach((r) => (out[r.cohortId].apps[r.status] = Number(r.n)));
  enrs.forEach((r) => (out[r.cohortId].enr[r.status] = Number(r.n)));
  return out;
}

// ---------- Programs ----------
router.get('/programs', async (req, res, next) => {
  try {
    const all = hasPermission(req.user, 'programs.manage');
    const ids = (req.user.staffAssignments || []).map((a) => a.programId);
    let rows = [];
    if (all || ids.length) {
      rows = await Program.findAll({
        where: all ? {} : { id: ids },
        include: [{ model: Cohort, required: false }, { model: ProgramStaff, as: 'staff', required: false, include: [User, Role] }],
        order: [['createdAt', 'DESC']],
      });
    }
    const cohortIds = rows.flatMap((p) => p.Cohorts.map((c) => c.id));
    const counts = await countsByCohort(cohortIds);
    const items = rows.map((p) => ({
      program: p,
      cohorts: p.Cohorts.length,
      open: p.Cohorts.filter((c) => c.status === 'open').length,
      pending: p.Cohorts.reduce((n, c) => n + (counts[c.id].apps.in_review || 0), 0),
      students: p.Cohorts.reduce((n, c) => n + (counts[c.id].enr.active || 0), 0),
      managers: p.staff.filter((s) => s.Role && s.Role.slug === 'manager').map((s) => s.User),
    }));
    res.render('admin/programs/index', { title: 'Programs', active: 'programs', items });
  } catch (err) {
    next(err);
  }
});

function parseProgram(req, existing) {
  const b = req.body;
  const errors = [];
  const tags = String(b.tags || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8).map((s) => s.slice(0, 30));
  const data = {
    title: String(b.title || '').trim().slice(0, 160),
    category: String(b.category || '').trim().slice(0, 80) || null,
    summary: String(b.summary || '').trim().slice(0, 300) || null,
    description: String(b.description || '').trim().slice(0, 12000) || null,
    tags,
    bannerUrl: existing ? existing.bannerUrl : null,
  };
  if (data.title.length < 3) errors.push('Give the program a title.');
  if (req.file) data.bannerUrl = banners.urlFor(req.file);
  else if (b.bannerUrlText && isSafeUrl(String(b.bannerUrlText).trim())) data.bannerUrl = String(b.bannerUrlText).trim();
  if (b.removeBanner === 'on' && !req.file) data.bannerUrl = null;
  return { data, errors };
}

async function uniqueSlug(title) {
  const base = slugify(title) || 'program';
  let slug = base;
  for (let i = 2; await Program.findOne({ where: { slug } }); i += 1) slug = `${base}-${i}`;
  return slug;
}

async function categoryList() {
  const rows = await Program.findAll({ attributes: ['category'], where: { category: { [Op.ne]: null } }, group: ['category'], raw: true });
  return rows.map((r) => r.category).sort();
}

router.get('/programs/new', needGlobal('programs.manage'), async (req, res, next) => {
  try {
    res.render('admin/programs/form', { title: 'New program', active: 'programs', p: { tags: [] }, errors: [], isNew: true, categories: await categoryList() });
  } catch (err) {
    next(err);
  }
});

router.post('/programs', needGlobal('programs.manage'), banners.run, verifyCsrf, async (req, res, next) => {
  try {
    const { data, errors } = parseProgram(req, null);
    if (errors.length) {
      if (req.file) banners.remove(data.bannerUrl);
      return res.status(400).render('admin/programs/form', { title: 'New program', active: 'programs', p: data, errors, isNew: true, categories: await categoryList() });
    }
    const program = await Program.create({ ...data, slug: await uniqueSlug(data.title), status: 'draft' });
    await audit(req, 'program.create', 'Program', program.id, { title: program.title });
    req.flash('success', 'Program created. Add a manager and a cohort, then publish it.');
    return res.redirect(`/admin/programs/${program.id}`);
  } catch (err) {
    return next(err);
  }
});

router.get('/programs/:programId', loadProgram, async (req, res, next) => {
  try {
    const [cohorts, staff, questionCount] = await Promise.all([
      Cohort.findAll({ where: { programId: req.program.id }, order: [['createdAt', 'DESC']] }),
      ProgramStaff.findAll({ where: { programId: req.program.id }, include: [User, Role] }),
      QuizQuestion.count({ where: { programId: req.program.id } }),
    ]);
    const counts = await countsByCohort(cohorts.map((c) => c.id));
    const rows = [];
    for (const c of cohorts) rows.push({ cohort: c, counts: counts[c.id], left: await enroll.seatsLeft(c) });
    res.render('admin/programs/show', { title: req.program.title, active: 'programs', rows, staff, questionCount });
  } catch (err) {
    next(err);
  }
});

router.get('/programs/:programId/edit', loadProgram, need('programs.edit'), async (req, res, next) => {
  try {
    res.render('admin/programs/form', { title: 'Edit program', active: 'programs', p: req.program, errors: [], isNew: false, categories: await categoryList() });
  } catch (err) {
    next(err);
  }
});

router.post('/programs/:programId', loadProgram, need('programs.edit'), banners.run, verifyCsrf, async (req, res, next) => {
  try {
    const old = req.program.bannerUrl;
    const { data, errors } = parseProgram(req, req.program);
    if (errors.length) {
      if (req.file) banners.remove(data.bannerUrl);
      return res.status(400).render('admin/programs/form', { title: 'Edit program', active: 'programs', p: { ...data, id: req.program.id, slug: req.program.slug }, errors, isNew: false, categories: await categoryList() });
    }
    await req.program.update(data);
    if (old && old !== data.bannerUrl) banners.remove(old);
    await audit(req, 'program.update', 'Program', req.program.id, { title: data.title });
    req.flash('success', 'Program saved.');
    return res.redirect(`/admin/programs/${req.program.id}`);
  } catch (err) {
    return next(err);
  }
});

router.post('/programs/:programId/status', loadProgram, need('programs.edit'), async (req, res, next) => {
  try {
    const next_ = String(req.body.status || '');
    const globalOnly = ['suspended', 'archived'];
    if (!['draft', 'published', 'suspended', 'archived'].includes(next_)) return res.redirect(`/admin/programs/${req.program.id}`);
    if (globalOnly.includes(next_) && !hasPermission(req.user, 'programs.manage')) return deny(res);
    const from = req.program.status;
    req.program.status = next_;
    await req.program.save();
    await audit(req, 'program.status', 'Program', req.program.id, { from, to: next_ });
    req.flash('success', `Program is now ${next_}.`);
    return res.redirect(`/admin/programs/${req.program.id}`);
  } catch (err) {
    return next(err);
  }
});

router.post('/programs/:programId/delete', loadProgram, needGlobal('programs.manage'), async (req, res, next) => {
  try {
    const cohorts = await Cohort.findAll({ where: { programId: req.program.id }, attributes: ['id'] });
    const ids = cohorts.map((c) => c.id);
    const used = ids.length ? (await Application.count({ where: { cohortId: ids } })) + (await Enrollment.count({ where: { cohortId: ids } })) + (await Payment.count({ where: { cohortId: ids } })) : 0;
    if (used) {
      req.flash('error', 'This program has applications, students or payments, so it cannot be deleted. Archive it instead.');
      return res.redirect(`/admin/programs/${req.program.id}`);
    }
    banners.remove(req.program.bannerUrl);
    await Cohort.destroy({ where: { programId: req.program.id } });
    await QuizQuestion.destroy({ where: { programId: req.program.id } });
    await ProgramStaff.destroy({ where: { programId: req.program.id } });
    await req.program.destroy();
    await audit(req, 'program.delete', 'Program', req.params.programId, { title: req.program.title });
    req.flash('success', 'Program deleted.');
    return res.redirect('/admin/programs');
  } catch (err) {
    return next(err);
  }
});

// ---------- Team ----------
async function assignableRoles(req) {
  const roles = await Role.findAll({ where: { scope: 'program' }, order: [['name', 'ASC']] });
  return roles.filter((r) => (r.slug !== 'manager' || hasPermission(req.user, 'programs.manage')) && (r.permissions || []).every((p) => canProgram(req.user, p, req.program.id)));
}

router.get('/programs/:programId/team', loadProgram, need('staff.manage'), async (req, res, next) => {
  try {
    const [staff, roles] = await Promise.all([ProgramStaff.findAll({ where: { programId: req.program.id }, include: [User, Role], order: [['createdAt', 'ASC']] }), assignableRoles(req)]);
    res.render('admin/programs/team', { title: `Team: ${req.program.title}`, active: 'programs', staff, roles });
  } catch (err) {
    next(err);
  }
});

router.post('/programs/:programId/team', loadProgram, need('staff.manage'), async (req, res, next) => {
  try {
    const back = `/admin/programs/${req.program.id}/team`;
    const email = String(req.body.email || '').trim().toLowerCase();
    const [user, role] = await Promise.all([User.findOne({ where: { email } }), Role.findByPk(parseInt(req.body.roleId, 10) || 0)]);
    const allowed = (await assignableRoles(req)).map((r) => r.id);
    if (!user) {
      req.flash('error', 'No account uses that email. Ask the person to create an account first.');
      return res.redirect(back);
    }
    if (!role || !allowed.includes(role.id)) {
      req.flash('error', 'You cannot assign that role.');
      return res.redirect(back);
    }
    const existing = await ProgramStaff.findOne({ where: { programId: req.program.id, userId: user.id }, include: [Role] });
    if (existing && existing.Role.slug === 'manager' && !hasPermission(req.user, 'programs.manage')) {
      req.flash('error', 'Only an admin can change a manager.');
      return res.redirect(back);
    }
    if (existing) await existing.update({ roleId: role.id });
    else await ProgramStaff.create({ programId: req.program.id, userId: user.id, roleId: role.id });
    await audit(req, 'program.staff.add', 'Program', req.program.id, { email: user.email, role: role.slug });
    try {
      await mailer.sendNotice({
        user,
        subject: `You have been added to ${req.program.title}`,
        heading: 'You have a new role',
        body: `${req.actor ? req.actor.name : 'An admin'} added you to ${req.program.title} as ${role.name}. Open the admin area to see what is waiting for you.`,
        buttonText: 'Open admin',
        buttonUrl: `${appUrl()}/admin/programs/${req.program.id}`,
      });
    } catch (e) {
      console.error('[mail] staff notice failed:', e.message);
    }
    req.flash('success', `${user.name} is now ${role.name} on this program.`);
    return res.redirect(back);
  } catch (err) {
    return next(err);
  }
});

router.post('/programs/:programId/team/:staffId/remove', loadProgram, need('staff.manage'), async (req, res, next) => {
  try {
    const back = `/admin/programs/${req.program.id}/team`;
    const row = await ProgramStaff.findOne({ where: { id: req.params.staffId, programId: req.program.id }, include: [User, Role] });
    if (!row) return res.redirect(back);
    if (row.Role.slug === 'manager' && !hasPermission(req.user, 'programs.manage')) {
      req.flash('error', 'Only an admin can remove a manager.');
      return res.redirect(back);
    }
    if (row.userId === req.actor.id && !hasPermission(req.user, 'programs.manage')) {
      req.flash('error', 'Ask another manager or an admin to remove you.');
      return res.redirect(back);
    }
    await row.destroy();
    await audit(req, 'program.staff.remove', 'Program', req.program.id, { email: row.User.email, role: row.Role.slug });
    req.flash('success', `${row.User.name} was removed from this program.`);
    return res.redirect(back);
  } catch (err) {
    return next(err);
  }
});

// ---------- Application quiz ----------
function parseQuestion(b) {
  const options = String(b.options || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6);
  const q = {
    prompt: String(b.prompt || '').trim().slice(0, 600),
    options,
    correctIndex: (parseInt(b.correct, 10) || 0) - 1,
    points: Math.min(Math.max(parseInt(b.points, 10) || 1, 1), 10),
  };
  const errors = [];
  if (q.prompt.length < 5) errors.push('Write the question.');
  if (options.length < 2) errors.push('Give at least two answer options, one per line.');
  if (q.correctIndex < 0 || q.correctIndex >= options.length) errors.push('Say which option is correct (its line number).');
  return { q, errors };
}

router.get('/programs/:programId/quiz', loadProgram, need('cohorts.manage'), async (req, res, next) => {
  try {
    const questions = await QuizQuestion.findAll({ where: { programId: req.program.id }, order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']] });
    res.render('admin/programs/quiz', { title: `Quiz: ${req.program.title}`, active: 'programs', questions });
  } catch (err) {
    next(err);
  }
});

router.post('/programs/:programId/quiz', loadProgram, need('cohorts.manage'), async (req, res, next) => {
  try {
    const back = `/admin/programs/${req.program.id}/quiz`;
    const { q, errors } = parseQuestion(req.body);
    if (errors.length) {
      req.flash('error', errors[0]);
      return res.redirect(back);
    }
    const last = await QuizQuestion.max('sortOrder', { where: { programId: req.program.id } });
    await QuizQuestion.create({ ...q, programId: req.program.id, sortOrder: (last || 0) + 1 });
    await audit(req, 'quiz.question.add', 'Program', req.program.id);
    req.flash('success', 'Question added.');
    return res.redirect(back);
  } catch (err) {
    return next(err);
  }
});

router.post('/programs/:programId/quiz/:qid', loadProgram, need('cohorts.manage'), async (req, res, next) => {
  try {
    const back = `/admin/programs/${req.program.id}/quiz`;
    const row = await QuizQuestion.findOne({ where: { id: req.params.qid, programId: req.program.id } });
    if (!row) return res.redirect(back);
    const { q, errors } = parseQuestion(req.body);
    if (errors.length) {
      req.flash('error', errors[0]);
      return res.redirect(back);
    }
    await row.update({ ...q, sortOrder: parseInt(req.body.sortOrder, 10) || row.sortOrder });
    await audit(req, 'quiz.question.update', 'Program', req.program.id);
    req.flash('success', 'Question saved.');
    return res.redirect(back);
  } catch (err) {
    return next(err);
  }
});

router.post('/programs/:programId/quiz/:qid/delete', loadProgram, need('cohorts.manage'), async (req, res, next) => {
  try {
    await QuizQuestion.destroy({ where: { id: req.params.qid, programId: req.program.id } });
    await audit(req, 'quiz.question.delete', 'Program', req.program.id);
    req.flash('success', 'Question deleted.');
    return res.redirect(`/admin/programs/${req.program.id}/quiz`);
  } catch (err) {
    return next(err);
  }
});

// ---------- Cohorts ----------
function parseCohort(b) {
  const errors = [];
  const int = (v, def) => (v === '' || v === undefined ? def : parseInt(v, 10));
  const full = nairaToKobo(b.fullFee || 0);
  const data = {
    name: String(b.name || '').trim().slice(0, 120),
    enrollmentMode: ['free', 'pay', 'application', 'community'].includes(b.enrollmentMode) ? b.enrollmentMode : 'application',
    fullFeeKobo: full === null ? 0 : full,
    scholarshipPercent: int(b.scholarshipPercent, 0),
    seats: b.seats === '' || b.seats === undefined ? null : int(b.seats, null),
    startsAt: fromLagosInput(b.startsAt),
    endsAt: fromLagosInput(b.endsAt),
    applicationDeadline: fromLagosInput(b.applicationDeadline),
    offerWindowHours: int(b.offerWindowHours, 72),
    passMark: int(b.passMark, 70),
    graceMark: int(b.graceMark, 60),
    attendanceRequiredPercent: int(b.attendanceRequiredPercent, 75),
    autoIssueCertificates: b.autoIssueCertificates === 'on',
    sponsorName: String(b.sponsorName || '').trim().slice(0, 120) || null,
    whatsappUrl: String(b.whatsappUrl || '').trim() || null,
    telegramUrl: String(b.telegramUrl || '').trim() || null,
  };
  if (!data.name) errors.push('Name the cohort.');
  if (full === null) errors.push('The full fee must be a number.');
  if (!(data.scholarshipPercent >= 0 && data.scholarshipPercent <= 100)) errors.push('Scholarship must be between 0 and 100.');
  if (data.seats !== null && !(data.seats >= 1)) errors.push('Seats must be 1 or more, or left empty for no limit.');
  if (data.startsAt && data.endsAt && data.endsAt <= data.startsAt) errors.push('The end date must be after the start date.');
  if (!(data.offerWindowHours >= 1 && data.offerWindowHours <= 720)) errors.push('The offer window must be between 1 and 720 hours.');
  if (!(data.passMark >= 1 && data.passMark <= 100)) errors.push('The pass mark must be between 1 and 100.');
  if (!(data.graceMark >= 0 && data.graceMark <= data.passMark)) errors.push('The grace mark must be between 0 and the pass mark.');
  if (!(data.attendanceRequiredPercent >= 0 && data.attendanceRequiredPercent <= 100)) errors.push('Required attendance must be between 0 and 100.');
  if ((data.whatsappUrl && !isHttps(data.whatsappUrl)) || (data.telegramUrl && !isHttps(data.telegramUrl))) errors.push('Community links must start with https://');
  return { data, errors };
}

router.get('/programs/:programId/cohorts/new', loadProgram, need('cohorts.manage'), (req, res) => {
  res.render('admin/cohorts/form', { title: 'New cohort', active: 'programs', c: { enrollmentMode: 'application', offerWindowHours: 72, passMark: 70, graceMark: 60, attendanceRequiredPercent: 75, scholarshipPercent: 0, fullFeeKobo: 0 }, errors: [], isNew: true });
});

router.post('/programs/:programId/cohorts', loadProgram, need('cohorts.manage'), async (req, res, next) => {
  try {
    const { data, errors } = parseCohort(req.body);
    if (errors.length) return res.status(400).render('admin/cohorts/form', { title: 'New cohort', active: 'programs', c: data, errors, isNew: true });
    const cohort = await Cohort.create({ ...data, programId: req.program.id, status: 'draft' });
    await audit(req, 'cohort.create', 'Cohort', cohort.id, { name: cohort.name, program: req.program.title });
    req.flash('success', 'Cohort created as a draft. Open it when you are ready.');
    return res.redirect(`/admin/cohorts/${cohort.id}`);
  } catch (err) {
    return next(err);
  }
});

router.get('/cohorts/:cohortId', loadCohort, async (req, res, next) => {
  try {
    const counts = (await countsByCohort([req.cohort.id]))[req.cohort.id];
    const left = await enroll.seatsLeft(req.cohort);
    const now = new Date();
    const [nextSession, noLink, upcomingCount] = await Promise.all([
      Session.findOne({ where: { cohortId: req.cohort.id, status: 'scheduled', endsAt: { [Op.gt]: now } }, order: [['startsAt', 'ASC']] }),
      Session.count({ where: { cohortId: req.cohort.id, status: 'scheduled', endsAt: { [Op.gt]: now }, [Op.or]: [{ meetLink: null }, { meetLink: '' }] } }),
      Session.count({ where: { cohortId: req.cohort.id, status: 'scheduled', endsAt: { [Op.gt]: now } } }),
    ]);
    res.render('admin/cohorts/show', { title: `${req.program.title}: ${req.cohort.name}`, active: 'programs', counts, left, payable: payableKobo(req.cohort), nextSession, noLink, upcomingCount });
  } catch (err) {
    next(err);
  }
});

router.get('/cohorts/:cohortId/edit', loadCohort, need('cohorts.manage'), (req, res) => {
  res.render('admin/cohorts/form', { title: 'Edit cohort', active: 'programs', c: req.cohort, errors: [], isNew: false });
});

router.post('/cohorts/:cohortId', loadCohort, need('cohorts.manage'), async (req, res, next) => {
  try {
    const { data, errors } = parseCohort(req.body);
    if (errors.length) return res.status(400).render('admin/cohorts/form', { title: 'Edit cohort', active: 'programs', c: { ...data, id: req.cohort.id }, errors, isNew: false });
    const oldSeats = req.cohort.seats;
    await req.cohort.update(data);
    await audit(req, 'cohort.update', 'Cohort', req.cohort.id, { name: data.name });
    // More seats may mean people on the waiting list can be offered one
    if (data.seats === null || (oldSeats !== null && data.seats > oldSeats)) await enroll.promoteWaitlist(req.cohort.id);
    req.flash('success', 'Cohort saved.');
    return res.redirect(`/admin/cohorts/${req.cohort.id}`);
  } catch (err) {
    return next(err);
  }
});

const TRANSITIONS = {
  open: { from: ['draft'], to: 'open', done: 'Cohort is open.' },
  close: { from: ['open'], to: 'closed', done: 'Cohort is closed to new people. Current students continue.' },
  reopen: { from: ['closed'], to: 'open', done: 'Cohort is open again.' },
  complete: { from: ['open', 'closed'], to: 'completed', done: 'Cohort marked as completed.' },
  suspend: { from: ['draft', 'open', 'closed', 'completed'], to: 'suspended', done: 'Cohort suspended. Students cannot open it.' },
  resume: { from: ['suspended'], to: 'closed', done: 'Cohort resumed as closed. Reopen it if you want new people to join.' },
};

router.post('/cohorts/:cohortId/status', loadCohort, need('cohorts.manage'), async (req, res, next) => {
  try {
    const t = TRANSITIONS[req.body.action];
    if (!t || !t.from.includes(req.cohort.status)) {
      req.flash('error', 'That change is not available for this cohort right now.');
      return res.redirect(`/admin/cohorts/${req.cohort.id}`);
    }
    const from = req.cohort.status;
    req.cohort.status = t.to;
    await req.cohort.save();
    await audit(req, 'cohort.status', 'Cohort', req.cohort.id, { from, to: t.to });
    let message = t.done;
    // Finishing a cohort issues certificates to everyone who met the attendance rule
    if (req.body.action === 'complete' && req.cohort.autoIssueCertificates) {
      const r = await issueForCohort(req.cohort.id, (req.actor || req.user).id);
      await audit(req, 'certificate.issue_all', 'Cohort', req.cohort.id, r);
      message = `${t.done} ${r.issued} certificate${r.issued === 1 ? '' : 's'} issued, ${r.skipped} below the attendance rule.`;
    }
    req.flash('success', message);
    return res.redirect(`/admin/cohorts/${req.cohort.id}`);
  } catch (err) {
    return next(err);
  }
});

router.post('/cohorts/:cohortId/delete', loadCohort, need('cohorts.manage'), async (req, res, next) => {
  try {
    const used = (await Application.count({ where: { cohortId: req.cohort.id } })) + (await Enrollment.count({ where: { cohortId: req.cohort.id } })) + (await Payment.count({ where: { cohortId: req.cohort.id } }));
    if (req.cohort.status !== 'draft' || used) {
      req.flash('error', 'Only an empty draft cohort can be deleted. Close or suspend it instead.');
      return res.redirect(`/admin/cohorts/${req.cohort.id}`);
    }
    await req.cohort.destroy();
    await audit(req, 'cohort.delete', 'Cohort', req.params.cohortId, { name: req.cohort.name });
    req.flash('success', 'Cohort deleted.');
    return res.redirect(`/admin/programs/${req.program.id}`);
  } catch (err) {
    return next(err);
  }
});

// ---------- Applications ----------
router.get('/cohorts/:cohortId/applications', loadCohort, need('applications.review'), async (req, res, next) => {
  try {
    const status = String(req.query.status || '').trim();
    const q = String(req.query.q || '').trim();
    const { page, limit, offset } = paginate(req, 25);
    const where = { cohortId: req.cohort.id };
    where.status = status ? status : { [Op.ne]: 'in_progress' };
    const userInclude = { model: User };
    if (q) userInclude.where = { [Op.or]: [{ name: { [Op.iLike]: `%${escLike(q)}%` } }, { email: { [Op.iLike]: `%${escLike(q)}%` } }] };
    const [{ rows, count }, counts, left] = await Promise.all([
      Application.findAndCountAll({ where, include: [userInclude], order: [['scorePercent', 'DESC NULLS LAST'], ['submittedAt', 'ASC']], limit, offset, distinct: true }),
      countsByCohort([req.cohort.id]),
      enroll.seatsLeft(req.cohort),
    ]);
    res.render('admin/cohorts/applications', {
      title: `Applications: ${req.cohort.name}`, active: 'programs', apps: rows, status, q, page, pages: Math.max(Math.ceil(count / limit), 1),
      counts: counts[req.cohort.id].apps, left, actions: enroll.ACTIONS,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/cohorts/:cohortId/applications/:appId/decision', loadCohort, need('applications.review'), async (req, res, next) => {
  try {
    const back = String(req.body.back || '').startsWith(`/admin/cohorts/${req.cohort.id}/applications`) ? req.body.back : `/admin/cohorts/${req.cohort.id}/applications`;
    const app = await Application.findOne({ where: { id: req.params.appId, cohortId: req.cohort.id }, include: [User] });
    if (!app) return notFound(res);
    const action = String(req.body.action || '');
    const note = String(req.body.note || '').trim().slice(0, 500);
    const graceApproval = action === 'offer' && app.status === 'in_review' && app.reviewReason === 'grace';
    if (!graceApproval && note.length < 3) {
      req.flash('error', 'Add a short reason. It is kept with the decision.');
      return res.redirect(back);
    }
    const from = app.status;
    const to = await enroll.applyDecision({ applicationId: app.id, action, note, actor: req.actor || req.user });
    await audit(req, `application.${action}`, 'Application', app.id, { applicant: app.User.email, from, to, note });
    req.flash('success', `${app.User.name}: ${action.replace('_', ' ')} done.`);
    return res.redirect(back);
  } catch (err) {
    if (/not available|not found/i.test(err.message)) {
      req.flash('error', err.message);
      return res.redirect(`/admin/cohorts/${req.params.cohortId}/applications`);
    }
    return next(err);
  }
});

// ---------- Students ----------
router.get('/cohorts/:cohortId/students', loadCohort, need('students.manage'), async (req, res, next) => {
  try {
    const status = String(req.query.status || '').trim();
    const q = String(req.query.q || '').trim();
    const { page, limit, offset } = paginate(req, 25);
    const where = { cohortId: req.cohort.id };
    if (status) where.status = status;
    const userInclude = { model: User };
    if (q) userInclude.where = { [Op.or]: [{ name: { [Op.iLike]: `%${escLike(q)}%` } }, { email: { [Op.iLike]: `%${escLike(q)}%` } }] };
    const { rows, count } = await Enrollment.findAndCountAll({ where, include: [userInclude], order: [['enrolledAt', 'DESC']], limit, offset, distinct: true });
    const levels = await statsFor(rows.map((e) => e.userId));
    res.render('admin/cohorts/students', { title: `Students: ${req.cohort.name}`, active: 'programs', levels, students: rows, status, q, page, pages: Math.max(Math.ceil(count / limit), 1), total: count });
  } catch (err) {
    next(err);
  }
});

router.post('/cohorts/:cohortId/students/:enrollmentId/status', loadCohort, need('students.manage'), async (req, res, next) => {
  try {
    const back = `/admin/cohorts/${req.cohort.id}/students`;
    const row = await Enrollment.findOne({ where: { id: req.params.enrollmentId, cohortId: req.cohort.id }, include: [User] });
    if (!row) return res.redirect(back);
    const action = String(req.body.action || '');
    const note = String(req.body.note || '').trim().slice(0, 500);
    const map = { suspend: 'suspended', reactivate: 'active', remove: 'removed' };
    if (!map[action]) return res.redirect(back);
    if (action !== 'reactivate' && note.length < 3) {
      req.flash('error', 'Add a short reason.');
      return res.redirect(back);
    }
    row.status = map[action];
    row.statusNote = action === 'reactivate' ? null : note;
    await row.save();
    await audit(req, `student.${action}`, 'Enrollment', row.id, { student: row.User.email, note });
    if (action === 'remove') await enroll.promoteWaitlist(req.cohort.id);
    req.flash('success', `${row.User.name}: ${action} done.`);
    return res.redirect(back);
  } catch (err) {
    return next(err);
  }
});

// ---------- Payments (platform-wide) ----------
router.get('/payments', needGlobal('payments.view'), async (req, res, next) => {
  try {
    const status = String(req.query.status || '').trim();
    const { page, limit, offset } = paginate(req, 30);
    const where = status ? { status } : {};
    const [{ rows, count }, total, paidCount] = await Promise.all([
      Payment.findAndCountAll({ where, include: [User, { model: Cohort, include: [Program] }], order: [['createdAt', 'DESC']], limit, offset, distinct: true }),
      Payment.sum('amountKobo', { where: { status: 'success' } }),
      Payment.count({ where: { status: 'success' } }),
    ]);
    res.render('admin/payments', { title: 'Payments', active: 'payments', payments: rows, status, page, pages: Math.max(Math.ceil(count / limit), 1), total: total || 0, paidCount, naira });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
