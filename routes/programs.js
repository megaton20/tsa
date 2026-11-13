const express = require('express');
const { Op } = require('sequelize');
const { Program, Cohort, Application, Enrollment, QuizQuestion, Session, Recording, Certificate } = require('../models');
const { studentAttendance, windowFor } = require('../services/sessions');
const { requireAuth } = require('../middleware/guards');
const enroll = require('../services/enrollment');
const payments = require('../services/payments');
const paystack = require('../services/paystack');
const { payableKobo, pickCohort } = require('../utils/cohort');
const { naira } = require('../utils/format');
const { canProgram } = require('../utils/permissions');

const router = express.Router();
const escLike = (s) => s.replace(/[\\%_]/g, '\\$&');
const EDUCATION = ['Secondary school', 'OND / NCE', 'HND / Bachelor\u2019s degree', 'Postgraduate', 'Other'];

// Students can look around while "viewing as", but cannot take actions in someone else's name.
function noImpersonation(req, res, next) {
  if (res.locals.isImpersonating) {
    req.flash('error', 'You are viewing as another user, so actions are switched off.');
    return res.redirect(req.get('referer') || '/dashboard');
  }
  return next();
}

async function loadCohort(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return Cohort.findByPk(id, { include: [Program] });
}

const signupOpen = (cohort) => cohort.Program.status === 'published' && cohort.status === 'open';
const deadlinePassed = (cohort) => cohort.applicationDeadline && new Date(cohort.applicationDeadline) < new Date();

// What the main button for one cohort should be, for this visitor.
function cohortCta({ cohort, program, user, application, enrollment, left, payable }) {
  if (enrollment && enrollment.status !== 'removed') {
    if (enrollment.status === 'suspended') return { type: 'note', tone: 'warn', text: 'Your access to this cohort is suspended. Contact support.' };
    return { type: 'link', href: `/cohorts/${cohort.id}`, label: 'Open your cohort', icon: 'fa-door-open' };
  }
  if (program.status !== 'published') return { type: 'note', text: 'This program is not taking students right now.' };

  if (cohort.enrollmentMode === 'application' && application) {
    const s = application.status;
    if (s === 'in_progress') {
      if (cohort.status !== 'open') return { type: 'note', text: 'Applications for this cohort are closed.' };
      return { type: 'link', href: application.submittedAt ? `/cohorts/${cohort.id}/quiz` : `/cohorts/${cohort.id}/apply`, label: 'Continue your application', icon: 'fa-pen-to-square' };
    }
    return { type: 'link', href: `/cohorts/${cohort.id}/application`, label: s === 'offered' ? 'View your offer' : 'See your application', icon: s === 'offered' ? 'fa-envelope-open-text' : 'fa-list-check', badge: s };
  }

  if (cohort.status === 'suspended') return { type: 'note', text: 'This cohort is unavailable right now.' };
  if (cohort.status === 'completed') return { type: 'note', text: 'This cohort has finished.' };
  if (cohort.status === 'closed') return { type: 'note', text: cohort.enrollmentMode === 'community' ? 'This community is closed.' : 'Enrollment for this cohort is closed.' };
  if (cohort.status !== 'open') return null;

  if (cohort.enrollmentMode === 'community') return { type: 'community' };
  if (!user) return { type: 'signin', label: cohort.enrollmentMode === 'application' ? 'Sign in to apply' : 'Sign in to enroll' };

  if (cohort.enrollmentMode === 'application') {
    if (deadlinePassed(cohort)) return { type: 'note', text: 'Applications for this cohort have closed.' };
    return { type: 'link', href: `/cohorts/${cohort.id}/apply`, label: left === 0 ? 'Apply for the waiting list' : 'Apply now', icon: 'fa-pen-to-square' };
  }
  if (left === 0) return { type: 'note', text: 'This cohort is full.' };
  if (cohort.enrollmentMode === 'pay' && payable > 0) return { type: 'post', action: `/cohorts/${cohort.id}/pay`, label: `Pay ${naira(payable)} and enroll`, icon: 'fa-credit-card' };
  return { type: 'post', action: `/cohorts/${cohort.id}/enroll`, label: 'Enroll for free', icon: 'fa-user-plus' };
}

// ---------- Catalogue ----------
router.get('/programs', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const category = String(req.query.category || '').trim();
    const where = { status: 'published' };
    if (q) where[Op.or] = [{ title: { [Op.iLike]: `%${escLike(q)}%` } }, { summary: { [Op.iLike]: `%${escLike(q)}%` } }];
    if (category) where.category = category;
    const [programs, cats] = await Promise.all([
      Program.findAll({ where, include: [{ model: Cohort, required: false, where: { status: { [Op.ne]: 'draft' } } }], order: [['createdAt', 'DESC']] }),
      Program.findAll({ attributes: ['category'], where: { status: 'published', category: { [Op.ne]: null } }, group: ['category'], raw: true }),
    ]);
    const items = programs.map((p) => ({ program: p, cohort: pickCohort(p.Cohorts || []) }));
    res.render('programs/index', { title: 'Programs', items, q, category, categories: cats.map((c) => c.category).filter(Boolean).sort() });
  } catch (err) {
    next(err);
  }
});

router.get('/programs/:slug', async (req, res, next) => {
  try {
    const program = await Program.findOne({ where: { slug: req.params.slug } });
    const preview = Boolean(program && program.status !== 'published' && req.user && canProgram(req.user, 'programs.edit', program.id));
    if (!program || (program.status !== 'published' && !preview)) return res.status(404).render('errors/404', { title: 'Program not found' });

    const cohorts = await Cohort.findAll({
      where: { programId: program.id, ...(preview ? {} : { status: { [Op.ne]: 'draft' } }) },
      order: [['startsAt', 'DESC NULLS LAST'], ['createdAt', 'DESC']],
    });
    const ids = cohorts.map((c) => c.id);
    const apps = {};
    const enrs = {};
    if (req.user && ids.length) {
      (await Application.findAll({ where: { userId: req.user.id, cohortId: ids } })).forEach((a) => (apps[a.cohortId] = a));
      (await Enrollment.findAll({ where: { userId: req.user.id, cohortId: ids } })).forEach((e) => (enrs[e.cohortId] = e));
    }
    const views = [];
    for (const cohort of cohorts) {
      const left = await enroll.seatsLeft(cohort);
      const payable = payableKobo(cohort);
      const application = apps[cohort.id] || null;
      const enrollment = enrs[cohort.id] || null;
      views.push({ cohort, left, payable, application, enrollment, cta: cohortCta({ cohort, program, user: req.user, application, enrollment, left, payable }) });
    }

    const others = await Program.findAll({ where: { status: 'published', id: { [Op.ne]: program.id } }, include: [{ model: Cohort, required: false, where: { status: { [Op.ne]: 'draft' } } }], order: [['createdAt', 'DESC']], limit: 8 });
    const related = others
      .sort((a, b) => Number(b.category === program.category) - Number(a.category === program.category))
      .slice(0, 3)
      .map((p) => ({ program: p, cohort: pickCohort(p.Cohorts || []) }));

    res.render('programs/show', { title: program.title, description: program.summary || undefined, program, views, related, preview });
  } catch (err) {
    next(err);
  }
});

// ---------- Free and paid enrollment ----------
router.post('/cohorts/:id/enroll', requireAuth, noImpersonation, async (req, res, next) => {
  try {
    const cohort = await loadCohort(req.params.id);
    if (!cohort) return res.status(404).render('errors/404', { title: 'Not found' });
    const back = `/programs/${cohort.Program.slug}`;
    const freeNow = cohort.enrollmentMode === 'free' || (cohort.enrollmentMode === 'pay' && payableKobo(cohort) === 0);
    if (!signupOpen(cohort) || !freeNow) {
      req.flash('error', 'Enrollment is not available for this cohort.');
      return res.redirect(back);
    }
    const result = await enroll.enrollFree(req.user.id, cohort.id);
    if (!result.ok) {
      req.flash('error', result.message);
      return res.redirect(back);
    }
    req.flash('success', result.already ? 'You are already enrolled.' : 'You are enrolled. Welcome to the cohort.');
    return res.redirect(`/cohorts/${cohort.id}`);
  } catch (err) {
    return next(err);
  }
});

router.post('/cohorts/:id/pay', requireAuth, noImpersonation, async (req, res, next) => {
  try {
    const cohort = await loadCohort(req.params.id);
    if (!cohort) return res.status(404).render('errors/404', { title: 'Not found' });
    const back = `/programs/${cohort.Program.slug}`;
    if (!signupOpen(cohort) || cohort.enrollmentMode !== 'pay' || payableKobo(cohort) <= 0) {
      req.flash('error', 'Payment is not available for this cohort.');
      return res.redirect(back);
    }
    const existing = await Enrollment.findOne({ where: { cohortId: cohort.id, userId: req.user.id, status: { [Op.ne]: 'removed' } } });
    if (existing) {
      req.flash('info', 'You are already enrolled in this cohort.');
      return res.redirect(`/cohorts/${cohort.id}`);
    }
    const left = await enroll.seatsLeft(cohort);
    if (left === 0) {
      req.flash('error', 'This cohort is full.');
      return res.redirect(back);
    }
    if (!paystack.isConfigured()) {
      req.flash('error', 'Online payments are not set up yet. Please try again later.');
      return res.redirect(back);
    }
    const url = await payments.startPayment({ user: req.user, cohort });
    return res.redirect(url);
  } catch (err) {
    console.error('[pay] could not start payment:', err.message);
    req.flash('error', 'We could not start the payment. Please try again.');
    return res.redirect(req.get('referer') || '/programs');
  }
});

// ---------- Application: details, quiz, status ----------
function parseDetails(b) {
  const clean = (v, max) => String(v || '').trim().slice(0, max);
  const d = {
    phone: clean(b.phone, 25),
    state: clean(b.state, 60),
    education: clean(b.education, 60),
    occupation: clean(b.occupation, 100),
    motivation: clean(b.motivation, 1200),
  };
  const errors = [];
  if (d.phone.replace(/\D/g, '').length < 7) errors.push('Enter a phone number we can reach you on.');
  if (d.state.length < 2) errors.push('Tell us where you are based.');
  if (!EDUCATION.includes(d.education)) errors.push('Choose your education level.');
  if (d.motivation.length < 30) errors.push('Tell us in a few sentences why you want to join (at least 30 characters).');
  return { d, errors };
}

async function applicationContext(req, res) {
  const cohort = await loadCohort(req.params.id);
  if (!cohort || cohort.enrollmentMode !== 'application') {
    res.status(404).render('errors/404', { title: 'Not found' });
    return null;
  }
  return cohort;
}

router.get('/cohorts/:id/apply', requireAuth, async (req, res, next) => {
  try {
    const cohort = await applicationContext(req, res);
    if (!cohort) return;
    const existing = await Application.findOne({ where: { cohortId: cohort.id, userId: req.user.id } });
    if (existing && existing.status !== 'in_progress') return res.redirect(`/cohorts/${cohort.id}/application`);
    if (!signupOpen(cohort) || deadlinePassed(cohort)) {
      req.flash('error', 'Applications for this cohort are closed.');
      return res.redirect(`/programs/${cohort.Program.slug}`);
    }
    const enrolled = await Enrollment.findOne({ where: { cohortId: cohort.id, userId: req.user.id, status: { [Op.ne]: 'removed' } } });
    if (enrolled) return res.redirect(`/cohorts/${cohort.id}`);
    const questionCount = await QuizQuestion.count({ where: { programId: cohort.programId } });
    return res.render('apply/details', { title: `Apply: ${cohort.Program.title}`, cohort, details: (existing && existing.details) || {}, errors: [], education: EDUCATION, questionCount });
  } catch (err) {
    return next(err);
  }
});

router.post('/cohorts/:id/apply', requireAuth, noImpersonation, async (req, res, next) => {
  try {
    const cohort = await applicationContext(req, res);
    if (!cohort) return;
    if (!signupOpen(cohort) || deadlinePassed(cohort)) {
      req.flash('error', 'Applications for this cohort are closed.');
      return res.redirect(`/programs/${cohort.Program.slug}`);
    }
    const [app] = await Application.findOrCreate({ where: { cohortId: cohort.id, userId: req.user.id }, defaults: { status: 'in_progress' } });
    if (app.status !== 'in_progress') return res.redirect(`/cohorts/${cohort.id}/application`);
    const { d, errors } = parseDetails(req.body);
    const questionCount = await QuizQuestion.count({ where: { programId: cohort.programId } });
    if (errors.length) {
      return res.status(400).render('apply/details', { title: `Apply: ${cohort.Program.title}`, cohort, details: d, errors, education: EDUCATION, questionCount });
    }
    app.details = d;
    app.submittedAt = app.submittedAt || new Date();
    await app.save();
    if (questionCount > 0) return res.redirect(`/cohorts/${cohort.id}/quiz`);
    await enroll.finalizeApplication(app.id);
    return res.redirect(`/cohorts/${cohort.id}/application`);
  } catch (err) {
    return next(err);
  }
});

async function quizContext(req, res) {
  const cohort = await applicationContext(req, res);
  if (!cohort) return {};
  const app = await Application.findOne({ where: { cohortId: cohort.id, userId: req.user.id } });
  if (!app) {
    res.redirect(`/cohorts/${cohort.id}/apply`);
    return {};
  }
  if (app.status !== 'in_progress') {
    res.redirect(`/cohorts/${cohort.id}/application`);
    return {};
  }
  if (!app.submittedAt) {
    res.redirect(`/cohorts/${cohort.id}/apply`);
    return {};
  }
  return { cohort, app };
}

router.get('/cohorts/:id/quiz', requireAuth, async (req, res, next) => {
  try {
    const { cohort, app } = await quizContext(req, res);
    if (!cohort) return;
    const questions = await QuizQuestion.findAll({ where: { programId: cohort.programId }, order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']] });
    if (!questions.length) {
      await enroll.finalizeApplication(app.id);
      return res.redirect(`/cohorts/${cohort.id}/application`);
    }
    return res.render('apply/quiz', { title: `Quiz: ${cohort.Program.title}`, cohort, questions, errors: [], answers: {} });
  } catch (err) {
    return next(err);
  }
});

router.post('/cohorts/:id/quiz', requireAuth, noImpersonation, async (req, res, next) => {
  try {
    const { cohort, app } = await quizContext(req, res);
    if (!cohort) return;
    const questions = await QuizQuestion.findAll({ where: { programId: cohort.programId }, order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']] });
    const sent = req.body.answers || {};
    const answers = {};
    questions.forEach((q) => {
      const n = parseInt(sent[q.id], 10);
      if (Number.isInteger(n) && n >= 0 && n < q.options.length) answers[q.id] = n;
    });
    if (Object.keys(answers).length < questions.length) {
      return res.status(400).render('apply/quiz', { title: `Quiz: ${cohort.Program.title}`, cohort, questions, errors: ['Answer every question before you submit.'], answers });
    }
    app.quizAnswers = answers;
    app.scorePercent = enroll.scoreQuiz(questions, answers);
    app.quizSubmittedAt = new Date();
    await app.save();
    await enroll.finalizeApplication(app.id);
    return res.redirect(`/cohorts/${cohort.id}/application`);
  } catch (err) {
    return next(err);
  }
});

router.get('/cohorts/:id/application', requireAuth, async (req, res, next) => {
  try {
    const cohort = await applicationContext(req, res);
    if (!cohort) return;
    const app = await Application.findOne({ where: { cohortId: cohort.id, userId: req.user.id } });
    if (!app) return res.redirect(`/cohorts/${cohort.id}/apply`);
    if (app.status === 'in_progress') return res.redirect(app.submittedAt ? `/cohorts/${cohort.id}/quiz` : `/cohorts/${cohort.id}/apply`);
    const enrollment = await Enrollment.findOne({ where: { cohortId: cohort.id, userId: req.user.id, status: { [Op.ne]: 'removed' } } });
    return res.render('apply/status', { title: 'Your application', cohort, app, enrollment, payable: payableKobo(cohort) });
  } catch (err) {
    return next(err);
  }
});

router.post('/cohorts/:id/application/accept', requireAuth, noImpersonation, async (req, res, next) => {
  try {
    const cohort = await applicationContext(req, res);
    if (!cohort) return;
    const back = `/cohorts/${cohort.id}/application`;
    if (payableKobo(cohort) > 0 && !paystack.isConfigured()) {
      req.flash('error', 'Online payments are not set up yet. Please try again later.');
      return res.redirect(back);
    }
    const result = await enroll.acceptOffer(req.user.id, cohort.id);
    if (!result.ok) {
      req.flash('error', result.message);
      return res.redirect(back);
    }
    if (result.enrolled) {
      req.flash('success', 'Seat confirmed. Welcome to the cohort.');
      return res.redirect(`/cohorts/${cohort.id}`);
    }
    const url = await payments.startPayment({ user: req.user, cohort, application: result.application });
    return res.redirect(url);
  } catch (err) {
    console.error('[accept] failed:', err.message);
    req.flash('error', 'We could not confirm your seat. Please try again.');
    return res.redirect(`/cohorts/${req.params.id}/application`);
  }
});

router.post('/cohorts/:id/application/withdraw', requireAuth, noImpersonation, async (req, res, next) => {
  try {
    const cohort = await applicationContext(req, res);
    if (!cohort) return;
    const done = await enroll.withdrawApplication(req.user.id, cohort.id);
    req.flash(done ? 'success' : 'info', done ? 'Your application has been withdrawn.' : 'There is nothing to withdraw.');
    return res.redirect(`/programs/${cohort.Program.slug}`);
  } catch (err) {
    return next(err);
  }
});

// ---------- Cohort home (enrolled students) ----------
router.get('/cohorts/:id', requireAuth, async (req, res, next) => {
  try {
    const cohort = await loadCohort(req.params.id);
    if (!cohort) return res.status(404).render('errors/404', { title: 'Not found' });
    const enrollment = await Enrollment.findOne({ where: { cohortId: cohort.id, userId: req.user.id, status: { [Op.in]: ['active', 'completed', 'suspended'] } } });
    if (!enrollment) {
      req.flash('info', 'Enroll in this cohort to open its page.');
      return res.redirect(`/programs/${cohort.Program.slug}`);
    }
    if (enrollment.status === 'suspended' || cohort.status === 'suspended' || cohort.Program.status === 'suspended') {
      return res.status(403).render('errors/suspended', { title: 'Access paused' });
    }
    const now = new Date();
    const [recordings, certificate] = await Promise.all([
      Recording.findAll({ where: { cohortId: cohort.id, status: 'published' }, order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']], limit: 5 }),
      Certificate.findOne({ where: { cohortId: cohort.id, userId: req.user.id } }),
    ]);
    const [att, cancelled] = await Promise.all([
      studentAttendance(cohort.id, req.user.id, now),
      Session.findAll({ where: { cohortId: cohort.id, status: 'cancelled', endsAt: { [Op.gt]: now } }, order: [['startsAt', 'ASC']] }),
    ]);
    const upcoming = att.sessions.filter((s) => new Date(s.endsAt) >= now);
    const past = att.sessions.filter((s) => new Date(s.endsAt) < now).reverse().slice(0, 8);
    return res.render('cohorts/home', { title: `${cohort.Program.title}: ${cohort.name}`, cohort, enrollment, att, upcoming, past, cancelled, windowFor, recordings, certificate });
  } catch (err) {
    return next(err);
  }
});

// ---------- Paystack ----------
router.get('/payments/callback', async (req, res) => {
  const reference = req.query.reference || req.query.trxref;
  if (!reference) return res.redirect('/dashboard');
  try {
    const payment = await payments.verifyAndSettle(String(reference));
    if (payment && payment.status === 'success') {
      req.flash('success', 'Payment received. You are enrolled.');
      return res.redirect(`/cohorts/${payment.cohortId}`);
    }
    req.flash('error', 'The payment was not completed, so nothing was charged. You can try again.');
    return res.redirect(payment ? `/cohorts/${payment.cohortId}/application` : '/dashboard');
  } catch (err) {
    console.error('[payments] callback verify failed:', err.message);
    req.flash('info', 'We are confirming your payment. Check your dashboard in a minute.');
    return res.redirect('/dashboard');
  }
});

router.post('/webhooks/paystack', async (req, res) => {
  if (!paystack.verifySignature(req.rawBody, req.get('x-paystack-signature'))) return res.sendStatus(401);
  try {
    const evt = req.body || {};
    if (evt.event === 'charge.success' && evt.data && evt.data.reference) {
      await payments.settlePayment(evt.data.reference, evt.data);
    }
    return res.sendStatus(200);
  } catch (err) {
    console.error('[webhook] paystack processing failed:', err.message);
    return res.sendStatus(500); // Paystack retries
  }
});

module.exports = router;
