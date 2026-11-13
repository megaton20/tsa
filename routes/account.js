const express = require('express');
const { Op, fn } = require('sequelize');
const { Enrollment, Application, Cohort, Program, Session, Recording, RecordingView, Certificate } = require('../models');
const { statsForUser } = require('../services/levels');
const { suggestFor } = require('../services/suggestions');
const { windowFor } = require('../services/sessions');
const { requireAuth } = require('../middleware/guards');

const router = express.Router();

router.get('/dashboard', requireAuth, async (req, res, next) => {
  try {
    const withCohort = [{ model: Cohort, include: [Program] }];
    const [enrollments, applications] = await Promise.all([
      Enrollment.findAll({ where: { userId: req.user.id, status: { [Op.in]: ['active', 'completed', 'suspended'] } }, include: withCohort, order: [['enrolledAt', 'DESC']] }),
      Application.findAll({ where: { userId: req.user.id, status: { [Op.notIn]: ['accepted', 'declined', 'withdrawn'] } }, include: withCohort, order: [['updatedAt', 'DESC']] }),
    ]);
    const cohortIds = enrollments.filter((e) => e.status === 'active').map((e) => e.cohortId);
    const sessions = cohortIds.length
      ? await Session.findAll({ where: { cohortId: cohortIds, status: 'scheduled', endsAt: { [Op.gt]: new Date() } }, include: [{ model: Cohort, include: [Program] }], order: [['startsAt', 'ASC']], limit: 4 })
      : [];
    const nextSessions = sessions.map((s) => ({ session: s, win: windowFor(s) }));
    const [stats, suggestions, certificates, lastViewed] = await Promise.all([
      statsForUser(req.user.id),
      suggestFor(req.user, 3),
      Certificate.findAll({ where: { userId: req.user.id, revokedAt: null } }),
      RecordingView.findAll({ where: { userId: req.user.id }, order: [['lastViewedAt', 'DESC']], limit: 3, include: [{ model: Recording, include: [{ model: Cohort, include: [Program] }] }] }),
    ]);
    // "Dive back in": finished cohorts, with what is still there to watch or download
    const past = enrollments.filter((e) => e.status === 'completed' || e.Cohort.status === 'completed');
    const pastIds = past.map((e) => e.cohortId);
    const recCounts = {};
    if (pastIds.length) {
      (await Recording.findAll({ attributes: ['cohortId', [fn('COUNT', '*'), 'n']], where: { cohortId: pastIds, status: 'published' }, group: ['cohortId'], raw: true })).forEach((r) => (recCounts[r.cohortId] = Number(r.n)));
    }
    const certByCohort = {};
    certificates.forEach((c) => (certByCohort[c.cohortId] = c));
    const diveBack = past.map((e) => ({ enrollment: e, cohort: e.Cohort, recordings: recCounts[e.cohortId] || 0, certificate: certByCohort[e.cohortId] || null }));
    res.render('dashboard', { title: 'Your dashboard', enrollments, applications, nextSessions, stats, suggestions, diveBack, lastViewed: lastViewed.filter((v) => v.Recording && v.Recording.status === 'published') });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
