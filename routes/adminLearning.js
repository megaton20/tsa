const express = require('express');
const { Op } = require('sequelize');
const { Recording, Certificate, Session, Enrollment, User, Cohort, Program } = require('../models');
const { requireAuth, requireAdminAccess } = require('../middleware/guards');
const { loadCohort, need, deny, notFound, isUuid, isStaffOn } = require('../middleware/adminLoaders');
const { canProgram } = require('../utils/permissions');
const { audit } = require('../services/audit');
const { parseYouTubeId } = require('../utils/youtube');
const { cohortAttendance } = require('../services/sessions');
const { issue, issueForCohort, notifyCertificate, isEligible } = require('../services/certificates');
const { statsFor } = require('../services/levels');

const router = express.Router();
router.use(requireAuth, requireAdminAccess);

// ---------- Recordings ----------
router.get('/cohorts/:cohortId/recordings', loadCohort, need('sessions.manage'), async (req, res, next) => {
  try {
    const [recordings, sessions] = await Promise.all([
      Recording.findAll({ where: { cohortId: req.cohort.id }, include: [{ model: Session, as: 'session', attributes: ['title', 'startsAt'] }], order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']] }),
      Session.findAll({ where: { cohortId: req.cohort.id }, order: [['startsAt', 'DESC']] }),
    ]);
    res.render('admin/learning/recordings', { title: `Recordings: ${req.cohort.name}`, active: 'programs', recordings, sessions });
  } catch (err) {
    next(err);
  }
});

async function parseRecording(req) {
  const youtubeId = parseYouTubeId(req.body.url);
  const title = String(req.body.title || '').trim().slice(0, 160);
  const errors = [];
  if (title.length < 3) errors.push('Give the recording a title.');
  if (!youtubeId) errors.push('Paste a YouTube link (watch, youtu.be, embed or live link).');
  let sessionId = null;
  if (isUuid(req.body.sessionId || '')) {
    const s = await Session.findOne({ where: { id: req.body.sessionId, cohortId: req.cohort.id } });
    sessionId = s ? s.id : null;
  }
  return { errors, data: { title, youtubeId, sessionId, description: String(req.body.description || '').trim().slice(0, 2000) || null } };
}

router.post('/cohorts/:cohortId/recordings', loadCohort, need('sessions.manage'), async (req, res, next) => {
  try {
    const back = `/admin/cohorts/${req.cohort.id}/recordings`;
    const { errors, data } = await parseRecording(req);
    if (errors.length) {
      req.flash('error', errors[0]);
      return res.redirect(back);
    }
    const last = await Recording.max('sortOrder', { where: { cohortId: req.cohort.id } });
    const rec = await Recording.create({ ...data, cohortId: req.cohort.id, sortOrder: (last || 0) + 1 });
    await audit(req, 'recording.add', 'Recording', rec.id, { title: rec.title });
    req.flash('success', 'Recording added. Enrolled students can watch it now.');
    return res.redirect(back);
  } catch (err) {
    return next(err);
  }
});

async function loadRecording(req, res, next) {
  try {
    const rec = isUuid(req.params.recordingId) ? await Recording.findByPk(req.params.recordingId, { include: [{ model: Cohort, include: [Program] }] }) : null;
    if (!rec) return notFound(res);
    if (!isStaffOn(req.user, rec.Cohort.programId) || !canProgram(req.user, 'sessions.manage', rec.Cohort.programId)) return deny(res);
    req.recording = rec;
    req.cohort = rec.Cohort;
    return next();
  } catch (err) {
    return next(err);
  }
}

router.post('/recordings/:recordingId', loadRecording, async (req, res, next) => {
  try {
    const rec = req.recording;
    const back = `/admin/cohorts/${rec.cohortId}/recordings`;
    const { errors, data } = await parseRecording(req);
    if (errors.length) {
      req.flash('error', errors[0]);
      return res.redirect(back);
    }
    await rec.update({ ...data, sortOrder: parseInt(req.body.sortOrder, 10) || rec.sortOrder });
    await audit(req, 'recording.update', 'Recording', rec.id, { title: rec.title });
    req.flash('success', 'Recording saved.');
    return res.redirect(back);
  } catch (err) {
    return next(err);
  }
});

router.post('/recordings/:recordingId/toggle', loadRecording, async (req, res, next) => {
  try {
    const rec = req.recording;
    rec.status = rec.status === 'published' ? 'hidden' : 'published';
    await rec.save();
    await audit(req, `recording.${rec.status === 'published' ? 'show' : 'hide'}`, 'Recording', rec.id, { title: rec.title });
    req.flash('success', rec.status === 'published' ? 'Recording is visible to students.' : 'Recording is hidden from students.');
    return res.redirect(`/admin/cohorts/${rec.cohortId}/recordings`);
  } catch (err) {
    return next(err);
  }
});

router.post('/recordings/:recordingId/delete', loadRecording, async (req, res, next) => {
  try {
    const rec = req.recording;
    await rec.destroy();
    await audit(req, 'recording.delete', 'Recording', rec.id, { title: rec.title });
    req.flash('success', 'Recording deleted.');
    return res.redirect(`/admin/cohorts/${rec.cohortId}/recordings`);
  } catch (err) {
    return next(err);
  }
});

// ---------- Certificates ----------
router.get('/cohorts/:cohortId/certificates', loadCohort, need('certificates.issue'), async (req, res, next) => {
  try {
    const { held, students } = await cohortAttendance(req.cohort.id);
    const certs = await Certificate.findAll({ where: { cohortId: req.cohort.id } });
    const byUser = {};
    certs.forEach((c) => (byUser[c.userId] = c));
    const rows = students.map((st) => ({
      user: st.user,
      enrollment: st.enrollment,
      percent: st.percent,
      attended: st.attended,
      eligible: ['active', 'completed'].includes(st.enrollment.status) && isEligible(req.cohort, st.percent, held.length),
      cert: byUser[st.user.id] || null,
    }));
    res.render('admin/learning/certificates', { title: `Certificates: ${req.cohort.name}`, active: 'programs', rows, held: held.length, issuedCount: certs.filter((c) => !c.revokedAt).length });
  } catch (err) {
    next(err);
  }
});

const backTo = (req) => `/admin/cohorts/${req.cohort.id}/certificates`;

router.post('/cohorts/:cohortId/certificates/issue-all', loadCohort, need('certificates.issue'), async (req, res, next) => {
  try {
    if (req.cohort.status !== 'completed') {
      req.flash('error', 'Mark the cohort as completed before issuing certificates.');
      return res.redirect(backTo(req));
    }
    const r = await issueForCohort(req.cohort.id, (req.actor || req.user).id);
    await audit(req, 'certificate.issue_all', 'Cohort', req.cohort.id, r);
    req.flash('success', `${r.issued} issued. ${r.already} already had one. ${r.skipped} did not meet the attendance rule.`);
    return res.redirect(backTo(req));
  } catch (err) {
    return next(err);
  }
});

// One student. A reason is required when they have not met the attendance rule.
router.post('/cohorts/:cohortId/certificates/issue', loadCohort, need('certificates.issue'), async (req, res, next) => {
  try {
    if (req.cohort.status !== 'completed') {
      req.flash('error', 'Mark the cohort as completed before issuing certificates.');
      return res.redirect(backTo(req));
    }
    const enrollment = await Enrollment.findOne({ where: { cohortId: req.cohort.id, userId: String(req.body.userId || ''), status: { [Op.in]: ['active', 'completed'] } }, include: [User] });
    if (!enrollment) return res.redirect(backTo(req));
    const { held, students } = await cohortAttendance(req.cohort.id);
    const st = students.find((s) => s.user.id === enrollment.userId);
    const eligible = isEligible(req.cohort, st ? st.percent : null, held.length);
    const note = String(req.body.note || '').trim().slice(0, 255);
    if (!eligible && note.length < 3) {
      req.flash('error', 'This student is below the attendance requirement. Add a reason to issue the certificate anyway.');
      return res.redirect(backTo(req));
    }
    const { certificate, created } = await issue({ cohort: req.cohort, program: req.program, user: enrollment.User, percent: st ? st.percent : null, issuedById: (req.actor || req.user).id, note: eligible ? null : note });
    if (created) await notifyCertificate(certificate);
    await audit(req, 'certificate.issue', 'Certificate', certificate.id, { student: enrollment.User.email, override: !eligible, note });
    req.flash('success', created ? `Certificate issued to ${enrollment.User.name}.` : 'That student already has a certificate.');
    return res.redirect(backTo(req));
  } catch (err) {
    return next(err);
  }
});

router.post('/cohorts/:cohortId/certificates/:certId/revoke', loadCohort, need('certificates.issue'), async (req, res, next) => {
  try {
    const cert = await Certificate.findOne({ where: { id: req.params.certId, cohortId: req.cohort.id } });
    if (!cert) return res.redirect(backTo(req));
    const reason = String(req.body.reason || '').trim().slice(0, 255);
    if (reason.length < 3) {
      req.flash('error', 'Add a reason for withdrawing the certificate.');
      return res.redirect(backTo(req));
    }
    await cert.update({ revokedAt: new Date(), revokedReason: reason });
    await audit(req, 'certificate.revoke', 'Certificate', cert.id, { code: cert.code, reason });
    req.flash('success', 'Certificate withdrawn. The verification page now says so.');
    return res.redirect(backTo(req));
  } catch (err) {
    return next(err);
  }
});

router.post('/cohorts/:cohortId/certificates/:certId/restore', loadCohort, need('certificates.issue'), async (req, res, next) => {
  try {
    const cert = await Certificate.findOne({ where: { id: req.params.certId, cohortId: req.cohort.id } });
    if (cert) {
      await cert.update({ revokedAt: null, revokedReason: null });
      await audit(req, 'certificate.restore', 'Certificate', cert.id, { code: cert.code });
      req.flash('success', 'Certificate restored.');
    }
    return res.redirect(backTo(req));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
