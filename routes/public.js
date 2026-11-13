const express = require('express');
const { Op } = require('sequelize');
const { HeroSlide, Program, Cohort } = require('../models');
const { pickCohort } = require('../utils/cohort');
const { requireAuth } = require('../middleware/guards');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const now = new Date();
    const slides = await HeroSlide.findAll({
      where: {
        isActive: true,
        [Op.and]: [
          { [Op.or]: [{ startsAt: null }, { startsAt: { [Op.lte]: now } }] },
          { [Op.or]: [{ endsAt: null }, { endsAt: { [Op.gte]: now } }] },
        ],
      },
      order: [['sortOrder', 'ASC'], ['createdAt', 'DESC']],
    });
    const programs = await Program.findAll({
      where: { status: 'published' },
      include: [{ model: Cohort, required: false, where: { status: { [Op.ne]: 'draft' } } }],
      order: [['createdAt', 'DESC']],
      limit: 6,
    });
    const featured = programs.map((pr) => ({ program: pr, cohort: pickCohort(pr.Cohorts || []) }));
    res.render('home', {
      featured,
      title: 'Cohort programs, live sessions and certificates',
      description: 'Join a cohort, attend live sessions, and finish with a certificate. Scholarships available.',
      slides,
    });
  } catch (err) {
    next(err);
  }
});

// The community prompt is shown once. Visitors get a cookie, signed-in users get a flag on their account.
router.post('/api/community-seen', async (req, res, next) => {
  try {
    res.cookie('tsa_wa_seen', '1', { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    if (req.user && !req.user.whatsappPromptSeen) {
      req.user.whatsappPromptSeen = true;
      await req.user.save();
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Remember the browser's time zone until the person picks one themselves.
router.post('/api/timezone', requireAuth, async (req, res, next) => {
  try {
    const tz = String((req.body && req.body.timezone) || '');
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
    } catch (e) {
      return res.status(400).json({ error: 'Unknown time zone' });
    }
    if (!req.user.timezoneConfirmed && req.user.timezone !== tz) {
      req.user.timezone = tz;
      await req.user.save();
    }
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
