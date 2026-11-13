const express = require('express');
const rateLimit = require('express-rate-limit');
const { Op } = require('sequelize');
const { Recording, RecordingView, Certificate, Cohort, Program, Enrollment } = require('../models');
const { requireAuth } = require('../middleware/guards');
const { embedUrl } = require('../utils/youtube');
const { normalizeCode } = require('../services/certificates');
const { buildCertificatePdf } = require('../services/certificatePdf');

const router = express.Router();
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v));
const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

// Enrolled students keep their recordings after the cohort ends (that is the point of "dive back in").
async function studentAccess(req, res, cohortId) {
  const cohort = isUuid(cohortId) ? await Cohort.findByPk(cohortId, { include: [Program] }) : null;
  if (!cohort) {
    res.status(404).render('errors/404', { title: 'Not found' });
    return null;
  }
  const enrollment = await Enrollment.findOne({ where: { cohortId: cohort.id, userId: req.user.id, status: { [Op.in]: ['active', 'completed', 'suspended'] } } });
  if (!enrollment) {
    req.flash('info', 'Enroll in this cohort to watch its recordings.');
    res.redirect(`/programs/${cohort.Program.slug}`);
    return null;
  }
  if (enrollment.status === 'suspended' || cohort.status === 'suspended' || cohort.Program.status === 'suspended') {
    res.status(403).render('errors/suspended', { title: 'Access paused' });
    return null;
  }
  return { cohort, enrollment };
}

const published = (cohortId) => ({ cohortId, status: 'published' });
const order = [['sortOrder', 'ASC'], ['createdAt', 'ASC']];

router.get('/cohorts/:id/recordings', requireAuth, async (req, res, next) => {
  try {
    const ctx = await studentAccess(req, res, req.params.id);
    if (!ctx) return;
    const recordings = await Recording.findAll({ where: published(ctx.cohort.id), order });
    const views = recordings.length ? await RecordingView.findAll({ where: { userId: req.user.id, recordingId: recordings.map((r) => r.id) } }) : [];
    const seen = {};
    views.forEach((v) => (seen[v.recordingId] = v));
    res.render('recordings/index', { title: `Recordings: ${ctx.cohort.name}`, cohort: ctx.cohort, recordings, seen });
  } catch (err) {
    next(err);
  }
});

router.get('/recordings/:id', requireAuth, async (req, res, next) => {
  try {
    const recording = isUuid(req.params.id) ? await Recording.findByPk(req.params.id) : null;
    if (!recording || recording.status !== 'published') return res.status(404).render('errors/404', { title: 'Not found' });
    const ctx = await studentAccess(req, res, recording.cohortId);
    if (!ctx) return;

    // Count the watch (not while a team member is "viewing as" a student)
    if (!res.locals.isImpersonating) {
      const now = new Date();
      const [view, created] = await RecordingView.findOrCreate({ where: { recordingId: recording.id, userId: req.user.id }, defaults: { firstViewedAt: now, lastViewedAt: now, viewCount: 1 } });
      if (!created) {
        view.lastViewedAt = now;
        view.viewCount += 1;
        await view.save();
      }
    }
    const all = await Recording.findAll({ where: published(ctx.cohort.id), order });
    const i = all.findIndex((r) => r.id === recording.id);
    res.render('recordings/show', {
      title: recording.title, recording, cohort: ctx.cohort, embed: embedUrl(recording.youtubeId),
      prev: i > 0 ? all[i - 1] : null, next: i >= 0 && i < all.length - 1 ? all[i + 1] : null, all,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- My certificates ----------
const mine = (req, code) => Certificate.findOne({ where: { code, userId: req.user.id } });

router.get('/certificates', requireAuth, async (req, res, next) => {
  try {
    const certificates = await Certificate.findAll({ where: { userId: req.user.id }, order: [['issuedAt', 'DESC']] });
    res.render('certificates/index', { title: 'Your certificates', certificates });
  } catch (err) {
    next(err);
  }
});

router.get('/certificates/:code', requireAuth, async (req, res, next) => {
  try {
    const code = normalizeCode(req.params.code);
    const certificate = code ? await mine(req, code) : null;
    if (!certificate) return res.status(404).render('errors/404', { title: 'Certificate not found' });
    res.render('certificates/show', { title: `Certificate ${certificate.code}`, certificate, verifyUrl: `${appUrl()}/verify/${certificate.code}` });
  } catch (err) {
    next(err);
  }
});

router.get('/certificates/:code/download.pdf', requireAuth, async (req, res, next) => {
  try {
    const code = normalizeCode(req.params.code);
    const c = code ? await mine(req, code) : null;
    if (!c) return res.status(404).render('errors/404', { title: 'Certificate not found' });
    if (c.revokedAt) {
      req.flash('error', 'This certificate has been withdrawn, so it cannot be downloaded.');
      return res.redirect(`/certificates/${c.code}`);
    }
    const pdf = buildCertificatePdf({
      recipientName: c.recipientName, programTitle: c.programTitle, cohortName: c.cohortName, completedOn: c.completedOn,
      issuedAt: c.issuedAt, attendancePercent: c.attendancePercent, code: c.code, verifyUrl: `${appUrl()}/verify/${c.code}`,
    });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="TSA-certificate-${c.code}.pdf"`, 'Cache-Control': 'private, no-store' });
    return res.send(pdf);
  } catch (err) {
    return next(err);
  }
});

// ---------- Public verification (no sign-in; never shows an email address) ----------
const verifyLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });

async function verifyPage(req, res, next, raw) {
  try {
    const typed = String(raw || '').trim();
    let result = null;
    if (typed) {
      const code = normalizeCode(typed);
      const certificate = code ? await Certificate.findOne({ where: { code } }) : null;
      result = certificate ? { state: certificate.revokedAt ? 'revoked' : 'valid', certificate } : { state: 'unknown' };
    }
    res.render('verify/index', { title: 'Verify a certificate', typed, result });
  } catch (err) {
    next(err);
  }
}

router.get('/verify', verifyLimiter, (req, res, next) => verifyPage(req, res, next, req.query.code));
router.get('/verify/:code', verifyLimiter, (req, res, next) => verifyPage(req, res, next, req.params.code));

module.exports = router;
