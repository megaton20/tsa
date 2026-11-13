const { Op, fn, col } = require('sequelize');
const { Task, Session, Cohort, Program, Application, ProgramStaff, Role, User } = require('../models');
const mailer = require('./mailer');
const { fmtWhen } = require('../utils/format');
const { hasPermission, canProgram } = require('../utils/permissions');

const HOUR = 60 * 60 * 1000;
const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const LIVE_COHORT = ['open', 'closed'];

async function upsertTask(def) {
  const [task, created] = await Task.findOrCreate({ where: { key: def.key }, defaults: { ...def, status: 'open' } });
  if (created) return task;
  const patch = { title: def.title, detail: def.detail, href: def.href };
  if (task.status === 'done') {
    Object.assign(patch, { status: 'open', dueAt: def.dueAt, nudgedAt: null, escalatedAt: null, ownerEscalatedAt: null, resolvedAt: null });
  }
  await task.update(patch);
  return task;
}

async function closeTasks(prefix, stillNeeded) {
  const open = await Task.findAll({ where: { status: 'open', key: { [Op.like]: `${prefix}:%` } } });
  for (const t of open) {
    if (!stillNeeded.has(t.key)) await t.update({ status: 'done', resolvedAt: new Date() });
  }
}

// Looks at the data and creates or closes tasks. Safe to run as often as you like.
async function syncTasks() {
  const now = new Date();

  // 1. Sessions that start soon but have no meeting link yet
  const missing = await Session.findAll({
    where: {
      status: 'scheduled',
      [Op.or]: [{ meetLink: null }, { meetLink: '' }],
      startsAt: { [Op.gt]: new Date(now.getTime() - HOUR), [Op.lte]: new Date(now.getTime() + 72 * HOUR) },
    },
    include: [{ model: Cohort, include: [Program] }],
  });
  const needMeet = new Set();
  for (const s of missing) {
    if (!LIVE_COHORT.includes(s.Cohort.status)) continue;
    const key = `meet:${s.id}`;
    needMeet.add(key);
    const byDay = new Date(new Date(s.startsAt).getTime() - 24 * HOUR);
    await upsertTask({
      key,
      programId: s.Cohort.programId,
      cohortId: s.cohortId,
      title: `Paste the meeting link for "${s.title}"`,
      detail: `${s.Cohort.Program.title}, ${s.Cohort.name}. Starts ${fmtWhen(s.startsAt)}.`,
      href: `/admin/cohorts/${s.cohortId}/sessions`,
      permission: 'sessions.manage',
      dueAt: byDay > now ? byDay : new Date(now.getTime() + 2 * HOUR),
    });
  }
  await closeTasks('meet', needMeet);

  // 2. Applications waiting for a manager
  const waiting = await Application.findAll({
    attributes: ['cohortId', [fn('MIN', col('updatedAt')), 'oldest'], [fn('COUNT', '*'), 'n']],
    where: { status: 'in_review' },
    group: ['cohortId'],
    raw: true,
  });
  const needReview = new Set();
  for (const w of waiting) {
    const cohort = await Cohort.findByPk(w.cohortId, { include: [Program] });
    if (!cohort || !LIVE_COHORT.includes(cohort.status)) continue;
    const key = `review:${cohort.id}`;
    needReview.add(key);
    const n = Number(w.n);
    await upsertTask({
      key,
      programId: cohort.programId,
      cohortId: cohort.id,
      title: `Review ${n} ${n === 1 ? 'application' : 'applications'} for ${cohort.name}`,
      detail: `${cohort.Program.title}. Applicants are waiting to hear back.`,
      href: `/admin/cohorts/${cohort.id}/applications?status=in_review`,
      permission: 'applications.review',
      dueAt: new Date(new Date(w.oldest).getTime() + 24 * HOUR),
    });
  }
  await closeTasks('review', needReview);
}

// ---------- who hears about it ----------
async function staffWith(programId, test) {
  const rows = await ProgramStaff.findAll({ where: { programId }, include: [User, Role] });
  return rows.filter((r) => r.User.status === 'active' && test(r.Role)).map((r) => r.User);
}

async function owners() {
  const users = await User.findAll({ where: { status: 'active' }, include: [Role] });
  return users.filter((u) => hasPermission(u, '*') || hasPermission(u, 'programs.manage'));
}

async function recipientsFor(task, level) {
  if (level === 'owner') return owners();
  if (level === 'manager') {
    const managers = await staffWith(task.programId, (r) => r.slug === 'manager');
    return managers.length ? managers : owners();
  }
  const assignees = await staffWith(task.programId, (r) => (r.permissions || []).includes(task.permission));
  if (assignees.length) return assignees;
  const managers = await staffWith(task.programId, (r) => r.slug === 'manager');
  return managers.length ? managers : owners();
}

async function emailTask(task, level) {
  const recipients = [...new Map((await recipientsFor(task, level)).map((u) => [u.id, u])).values()];
  const copy = {
    assignee: { subject: `Action needed: ${task.title}`, heading: 'Something needs you', lead: '' },
    manager: { subject: `Overdue: ${task.title}`, heading: 'A task is overdue', lead: 'This was due and is still open. ' },
    owner: { subject: `Still open: ${task.title}`, heading: 'A task has been open for a day past its deadline', lead: 'It has already been passed to the program team. ' },
  }[level];
  for (const user of recipients) {
    try {
      await mailer.sendNotice({
        user,
        subject: copy.subject,
        heading: copy.heading,
        body: `${copy.lead}${task.title}. ${task.detail || ''}`.trim(),
        buttonText: 'Open it',
        buttonUrl: `${appUrl()}${task.href || '/admin/tasks'}`,
      });
    } catch (err) {
      console.error('[tasks] email failed:', err.message);
    }
  }
}

// First nudge to the people who can do it, then the manager when overdue, then the owner a day later.
async function notifyTasks() {
  const now = new Date();
  const open = await Task.findAll({ where: { status: 'open' } });
  for (const t of open) {
    const [nudged] = await Task.update({ nudgedAt: now }, { where: { id: t.id, nudgedAt: null, status: 'open' } });
    if (nudged) await emailTask(t, 'assignee');
    if (t.dueAt < now) {
      const [esc] = await Task.update({ escalatedAt: now }, { where: { id: t.id, escalatedAt: null, status: 'open' } });
      if (esc) await emailTask(t, 'manager');
    }
    if (new Date(t.dueAt).getTime() < now.getTime() - 24 * HOUR) {
      const [own] = await Task.update({ ownerEscalatedAt: now }, { where: { id: t.id, ownerEscalatedAt: null, status: 'open' } });
      if (own) await emailTask(t, 'owner');
    }
  }
}

// Open tasks this person is responsible for (or oversees)
async function visibleTasks(user, limit = null) {
  const all = hasPermission(user, 'programs.manage');
  const ids = (user.staffAssignments || []).map((a) => a.programId);
  if (!all && !ids.length) return [];
  const rows = await Task.findAll({
    where: { status: 'open', ...(all ? {} : { programId: ids }) },
    include: [Program, { model: Cohort, required: false }],
    order: [['dueAt', 'ASC']],
  });
  const mine = rows.filter((t) => canProgram(user, t.permission, t.programId) || (user.staffAssignments || []).some((a) => a.programId === t.programId && a.Role && a.Role.slug === 'manager'));
  return limit ? mine.slice(0, limit) : mine;
}

async function resolveTask(key) {
  await Task.update({ status: 'done', resolvedAt: new Date() }, { where: { key, status: 'open' } });
}

module.exports = { syncTasks, notifyTasks, visibleTasks, resolveTask };
