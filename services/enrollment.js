// Seats, scholarship offers, waitlist and enrollment rules. Everything that changes seats runs
// inside a transaction that locks the cohort row, so two people cannot take the last seat together.
const { Op } = require('sequelize');
const { sequelize, Cohort, Application, Enrollment, User, Program } = require('../models');
const mailer = require('./mailer');
const { fmtDateTime, naira } = require('../utils/format');
const { payableKobo } = require('../utils/cohort');

const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const HOUR = 60 * 60 * 1000;

// What a manager may do to an application in each state
const ACTIONS = {
  in_review: ['offer', 'waitlist', 'not_selected'],
  waitlisted: ['offer', 'not_selected'],
  not_selected: ['offer', 'waitlist', 'reset_quiz'],
  expired: ['offer'],
  declined: ['offer'],
  withdrawn: ['offer'],
  offered: ['extend', 'waitlist'],
};

function withCohortLock(cohortId, fn) {
  return sequelize.transaction(async (t) => {
    const cohort = await Cohort.findByPk(cohortId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!cohort) throw new Error('Cohort not found');
    return fn(cohort, t);
  });
}

// Seats in use = people enrolled + open offers that are holding a seat
async function seatsTaken(cohortId, t) {
  const [enrolled, offered] = await Promise.all([
    Enrollment.count({ where: { cohortId, status: { [Op.in]: ['active', 'suspended', 'completed'] } }, transaction: t }),
    Application.count({ where: { cohortId, status: 'offered' }, transaction: t }),
  ]);
  return enrolled + offered;
}

// null means unlimited
async function seatsLeft(cohort, t) {
  if (cohort.seats === null || cohort.seats === undefined) return null;
  return Math.max(cohort.seats - (await seatsTaken(cohort.id, t)), 0);
}

async function enrollUser({ cohortId, userId, source, applicationId = null, paymentId = null, transaction }) {
  const [enrollment, created] = await Enrollment.findOrCreate({
    where: { cohortId, userId },
    defaults: { source, applicationId, paymentId, status: 'active', enrolledAt: new Date() },
    transaction,
  });
  if (!created && enrollment.status === 'removed') {
    Object.assign(enrollment, { status: 'active', source, applicationId, paymentId, statusNote: null, enrolledAt: new Date() });
    await enrollment.save({ transaction });
    return { enrollment, created: true };
  }
  return { enrollment, created };
}

async function makeOffer(app, cohort, type, t) {
  const now = new Date();
  app.status = 'offered';
  app.offerType = type;
  app.offeredAt = now;
  app.offerExpiresAt = new Date(now.getTime() + cohort.offerWindowHours * HOUR);
  await app.save({ transaction: t });
}

function scoreQuiz(questions, answers) {
  let total = 0;
  let earned = 0;
  questions.forEach((q) => {
    total += q.points;
    if (Number(answers[q.id]) === q.correctIndex) earned += q.points;
  });
  return total ? Math.round((earned / total) * 100) : null;
}

// ---------- emails ----------
async function notifyApplication(applicationId, kind) {
  try {
    const app = await Application.findByPk(applicationId, { include: [User, { model: Cohort, include: [Program] }] });
    if (!app) return;
    const user = app.User;
    const cohort = app.Cohort;
    const label = `${cohort.Program.title} (${cohort.name})`;
    const first = user.name.split(' ')[0];
    const link = `${appUrl()}/cohorts/${cohort.id}/application`;
    const due = payableKobo(cohort);
    const messages = {
      offer: {
        subject: `You have a seat: ${label}`,
        heading: 'You have a seat',
        body: `Good news, ${first}. You have been offered a seat in ${label}. Accept it by ${fmtDateTime(app.offerExpiresAt, user.timezone)}, or it goes to the next person on the list.${due ? ` A seat fee of ${naira(due)} confirms it.` : ' There is nothing to pay.'}`,
        button: 'View your offer',
      },
      in_review: {
        subject: `We received your application: ${label}`,
        heading: 'Your application is in review',
        body: `Thanks, ${first}. Your score is close to the pass mark, so the program manager will look at your application personally. You will hear from us by email.`,
        button: 'See your application',
      },
      waitlisted: {
        subject: `You are on the waiting list: ${label}`,
        heading: 'You are on the waiting list',
        body: `${first}, you qualified for ${label}, but every seat is taken right now. If a seat opens, we will email you straight away.`,
        button: 'See your application',
      },
      not_selected: {
        subject: `Your application: ${label}`,
        heading: 'Thank you for applying',
        body: `${first}, we could not offer you a seat in ${label} this time. We run new cohorts regularly, and you are welcome to apply again.`,
        button: 'Browse programs',
      },
      expired: {
        subject: `Your seat offer expired: ${label}`,
        heading: 'Your seat offer expired',
        body: `${first}, the time to accept your seat in ${label} has passed, so it has been released. Contact support if you still want a place.`,
        button: 'See your application',
      },
    };
    const m = messages[kind];
    if (!m) return;
    await mailer.sendNotice({
      user,
      subject: m.subject,
      heading: m.heading,
      body: m.body,
      buttonText: m.button,
      buttonUrl: kind === 'not_selected' ? `${appUrl()}/programs` : link,
    });
  } catch (err) {
    console.error('[notify] application email failed:', err.message);
  }
}

async function notifyEnrollment(userId, cohortId, paidKobo) {
  try {
    const [user, cohort] = await Promise.all([User.findByPk(userId), Cohort.findByPk(cohortId, { include: [Program] })]);
    if (!user || !cohort) return;
    await mailer.sendNotice({
      user,
      subject: `You are in: ${cohort.Program.title} (${cohort.name})`,
      heading: 'You are enrolled',
      body: `Welcome, ${user.name.split(' ')[0]}. Your place in ${cohort.Program.title} (${cohort.name}) is confirmed.${paidKobo ? ` We received ${naira(paidKobo)}.` : ''} Your sessions will appear on your cohort page.`,
      buttonText: 'Open your cohort',
      buttonUrl: `${appUrl()}/cohorts/${cohort.id}`,
    });
  } catch (err) {
    console.error('[notify] enrollment email failed:', err.message);
  }
}

// ---------- waitlist ----------
async function promoteWaitlist(cohortId) {
  const offered = [];
  await withCohortLock(cohortId, async (cohort, t) => {
    if (!['open', 'closed'].includes(cohort.status)) return;
    let left = await seatsLeft(cohort, t);
    if (left === null) return;
    while (left > 0) {
      const next = await Application.findOne({
        where: { cohortId, status: 'waitlisted' },
        order: [['scorePercent', 'DESC NULLS LAST'], ['quizSubmittedAt', 'ASC']],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!next) break;
      await makeOffer(next, cohort, 'waitlist', t);
      offered.push(next.id);
      left -= 1;
    }
  });
  for (const id of offered) await notifyApplication(id, 'offer');
  return offered.length;
}

// ---------- applications ----------
// Runs once the quiz is scored (or immediately when the program has no quiz).
async function finalizeApplication(applicationId) {
  const found = await Application.findByPk(applicationId, { attributes: ['cohortId'] });
  let outcome = null;
  await withCohortLock(found.cohortId, async (cohort, t) => {
    const app = await Application.findByPk(applicationId, { transaction: t, lock: t.LOCK.UPDATE });
    if (app.status !== 'in_progress') {
      outcome = app.status;
      return;
    }
    const score = app.scorePercent;
    if (score === null || score === undefined) {
      app.status = 'in_review';
      app.reviewReason = 'no_quiz';
    } else if (score >= cohort.passMark) {
      const left = await seatsLeft(cohort, t);
      if (left === null || left > 0) await makeOffer(app, cohort, 'auto', t);
      else app.status = 'waitlisted';
    } else if (score >= cohort.graceMark) {
      app.status = 'in_review';
      app.reviewReason = 'grace';
    } else {
      app.status = 'not_selected';
    }
    await app.save({ transaction: t });
    outcome = app.status;
  });
  await notifyApplication(applicationId, outcome === 'offered' ? 'offer' : outcome);
  return outcome;
}

// Manager or admin decision. Manual offers deliberately ignore the seat limit.
async function applyDecision({ applicationId, action, note, actor }) {
  const found = await Application.findByPk(applicationId, { attributes: ['cohortId'] });
  if (!found) throw new Error('Application not found');
  let notifyKind = null;
  let finalStatus = null;
  await withCohortLock(found.cohortId, async (cohort, t) => {
    const app = await Application.findByPk(applicationId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!(ACTIONS[app.status] || []).includes(action)) throw new Error('That action is not available for this application.');
    if (action === 'offer') {
      await makeOffer(app, cohort, app.reviewReason === 'grace' && app.status === 'in_review' ? 'grace' : 'manual', t);
      notifyKind = 'offer';
    } else if (action === 'waitlist') {
      app.status = 'waitlisted';
      notifyKind = 'waitlisted';
    } else if (action === 'not_selected') {
      app.status = 'not_selected';
      notifyKind = 'not_selected';
    } else if (action === 'extend') {
      const base = Math.max(Date.now(), app.offerExpiresAt ? app.offerExpiresAt.getTime() : 0);
      app.offerExpiresAt = new Date(base + cohort.offerWindowHours * HOUR);
    } else if (action === 'reset_quiz') {
      Object.assign(app, { status: 'in_progress', quizAnswers: null, scorePercent: null, quizSubmittedAt: null, reviewReason: null });
    }
    app.decisionNote = note || null;
    app.decidedById = actor.id;
    await app.save({ transaction: t });
    finalStatus = app.status;
  });
  if (notifyKind) await notifyApplication(applicationId, notifyKind);
  // Seats may have been freed
  if (['waitlist', 'not_selected'].includes(action)) await promoteWaitlist(found.cohortId);
  return finalStatus;
}

// Student accepts an offer. Free seats enroll immediately; otherwise the caller starts a payment.
async function acceptOffer(userId, cohortId) {
  let result = { ok: false, message: 'There is no open offer to accept.' };
  await withCohortLock(cohortId, async (cohort, t) => {
    const app = await Application.findOne({ where: { cohortId, userId, status: 'offered' }, transaction: t, lock: t.LOCK.UPDATE });
    if (!app) return;
    if (app.offerExpiresAt && app.offerExpiresAt < new Date()) {
      result = { ok: false, message: 'This offer has expired.' };
      return;
    }
    if (payableKobo(cohort) === 0) {
      await enrollUser({ cohortId, userId, source: 'scholarship', applicationId: app.id, transaction: t });
      app.status = 'accepted';
      app.acceptedAt = new Date();
      await app.save({ transaction: t });
      result = { ok: true, enrolled: true };
    } else {
      result = { ok: true, enrolled: false, application: app };
    }
  });
  if (result.enrolled) await notifyEnrollment(userId, cohortId, 0);
  return result;
}

// Student leaves the process (or turns down an offer). Frees a seat if they held one.
async function withdrawApplication(userId, cohortId) {
  const app = await Application.findOne({ where: { cohortId, userId, status: { [Op.in]: ['in_progress', 'in_review', 'waitlisted', 'offered'] } } });
  if (!app) return false;
  const heldSeat = app.status === 'offered';
  app.status = heldSeat ? 'declined' : 'withdrawn';
  await app.save();
  if (heldSeat) await promoteWaitlist(cohortId);
  return true;
}

async function enrollFree(userId, cohortId) {
  let result = { ok: false, message: 'Enrollment is not available.' };
  await withCohortLock(cohortId, async (cohort, t) => {
    const existing = await Enrollment.findOne({ where: { cohortId, userId }, transaction: t });
    if (existing && existing.status !== 'removed') {
      result = { ok: true, already: true };
      return;
    }
    const left = await seatsLeft(cohort, t);
    if (left !== null && left <= 0) {
      result = { ok: false, message: 'This cohort is full.' };
      return;
    }
    await enrollUser({ cohortId, userId, source: 'free', transaction: t });
    result = { ok: true, enrolled: true };
  });
  if (result.enrolled) await notifyEnrollment(userId, cohortId, 0);
  return result;
}

async function expireOffers() {
  const overdue = await Application.findAll({ where: { status: 'offered', offerExpiresAt: { [Op.lt]: new Date() } }, attributes: ['id', 'cohortId'] });
  const cohorts = new Set();
  for (const a of overdue) {
    const [changed] = await Application.update(
      { status: 'expired' },
      { where: { id: a.id, status: 'offered', offerExpiresAt: { [Op.lt]: new Date() } } }
    );
    if (changed) {
      cohorts.add(a.cohortId);
      await notifyApplication(a.id, 'expired');
    }
  }
  for (const id of cohorts) await promoteWaitlist(id);
  return cohorts.size;
}

module.exports = {
  ACTIONS, withCohortLock, seatsTaken, seatsLeft, enrollUser, scoreQuiz, finalizeApplication, applyDecision,
  acceptOffer, withdrawApplication, enrollFree, promoteWaitlist, expireOffers, notifyApplication, notifyEnrollment,
};
