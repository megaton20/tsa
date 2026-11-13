const { Program, Cohort, Session } = require('../models');
const { hasPermission, canProgram } = require('../utils/permissions');

const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v));
const deny = (res) => res.status(403).render('errors/403', { title: 'Access denied' });
const notFound = (res) => res.status(404).render('errors/404', { title: 'Not found' });

// Global admins, or anyone assigned to the program
const isStaffOn = (user, programId) =>
  hasPermission(user, 'programs.manage') || (user.staffAssignments || []).some((a) => a.programId === programId);

function setProgram(req, res, program) {
  req.program = program;
  res.locals.program = program;
  res.locals.canP = (perm) => canProgram(req.user, perm, program.id);
}

async function loadProgram(req, res, next) {
  try {
    if (!isUuid(req.params.programId)) return notFound(res);
    const program = await Program.findByPk(req.params.programId);
    if (!program) return notFound(res);
    if (!isStaffOn(req.user, program.id)) return deny(res);
    setProgram(req, res, program);
    return next();
  } catch (err) {
    return next(err);
  }
}

async function loadCohort(req, res, next) {
  try {
    if (!isUuid(req.params.cohortId)) return notFound(res);
    const cohort = await Cohort.findByPk(req.params.cohortId, { include: [Program] });
    if (!cohort) return notFound(res);
    if (!isStaffOn(req.user, cohort.programId)) return deny(res);
    req.cohort = cohort;
    res.locals.cohort = cohort;
    setProgram(req, res, cohort.Program);
    return next();
  } catch (err) {
    return next(err);
  }
}

async function loadSession(req, res, next) {
  try {
    if (!isUuid(req.params.sessionId)) return notFound(res);
    const session = await Session.findByPk(req.params.sessionId, { include: [{ model: Cohort, include: [Program] }] });
    if (!session) return notFound(res);
    if (!isStaffOn(req.user, session.Cohort.programId)) return deny(res);
    req.session_ = session;
    req.cohort = session.Cohort;
    res.locals.sessionRow = session;
    res.locals.cohort = session.Cohort;
    setProgram(req, res, session.Cohort.Program);
    return next();
  } catch (err) {
    return next(err);
  }
}

const need = (perm) => (req, res, next) => (canProgram(req.user, perm, req.program.id) ? next() : deny(res));
const needGlobal = (perm) => (req, res, next) => (hasPermission(req.user, perm) ? next() : deny(res));

module.exports = { isUuid, deny, notFound, isStaffOn, loadProgram, loadCohort, loadSession, need, needGlobal };
