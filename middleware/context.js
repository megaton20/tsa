const { User, Role, ProgramStaff } = require('../models');
const { hasPermission, canAccessAdmin } = require('../utils/permissions');
const labels = require('../utils/labels');
const { naira, fmtDateTime, fmtDate, fmtWhen, toLagosInput } = require('../utils/format');
const { priceLabel, payableKobo } = require('../utils/cohort');
const { getSettings } = require('../services/settings');
const { cssInfo } = require('../config/css');
const { googleEnabled } = require('../config/passport');
const { getCookie } = require('../utils/format');

// Loads the signed-in user, flash messages, site settings and view helpers for every request.
async function loadContext(req, res, next) {
  try {
    req.flash = (type, message) => {
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type, message });
    };

    let actor = null;
    let user = null;

    if (req.session.userId) {
      actor = await User.findByPk(req.session.userId, { include: [Role] });
      if (!actor || actor.status !== 'active') {
        const suspended = actor && actor.status === 'suspended';
        delete req.session.userId;
        delete req.session.impersonateId;
        actor = null;
        if (suspended) req.flash('error', 'Your account is suspended. Contact support if you think this is a mistake.');
      }
    }

    user = actor;
    if (actor && req.session.impersonateId) {
      const target = await User.findByPk(req.session.impersonateId, { include: [Role] });
      if (target && target.status === 'active' && hasPermission(actor, 'users.impersonate')) {
        user = target;
      } else {
        delete req.session.impersonateId;
      }
    }

    // Programs this person is assigned to (their program-scoped roles live here)
    if (user) user.staffAssignments = await ProgramStaff.findAll({ where: { userId: user.id }, include: [Role] });

    const settings = await getSettings();
    const hasCommunityLinks = Boolean(settings.whatsappChannelUrl || settings.whatsappGroupUrl || settings.telegramUrl);
    const seen = user ? user.whatsappPromptSeen : getCookie(req, 'tsa_wa_seen') === '1';

    req.user = user;
    req.actor = actor;

    res.locals.appName = 'True Series Academy';
    res.locals.css = cssInfo();
    res.locals.currentUser = user;
    res.locals.actorUser = actor;
    res.locals.isImpersonating = Boolean(actor && user && actor.id !== user.id);
    res.locals.can = (permission) => hasPermission(user, permission);
    res.locals.canAdmin = canAccessAdmin(user);
    res.locals.labels = labels;
    res.locals.naira = naira;
    res.locals.priceLabel = priceLabel;
    res.locals.payableKobo = payableKobo;
    res.locals.toLagosInput = toLagosInput;
    // Dates show in the signed-in person's time zone (Lagos for visitors)
    const zone = (tz) => tz || (user && user.timezone) || 'Africa/Lagos';
    res.locals.fmtDateTime = (d, tz) => fmtDateTime(d, zone(tz));
    res.locals.fmtDate = (d, tz) => fmtDate(d, zone(tz));
    res.locals.fmtWhen = (d, tz) => fmtWhen(d, zone(tz));
    res.locals.tzName = zone();
    res.locals.settings = settings;
    res.locals.googleEnabled = googleEnabled();
    res.locals.currentPath = req.path;
    res.locals.currentUrl = req.originalUrl;
    res.locals.showCommunityPrompt = hasCommunityLinks && !seen;
    res.locals.flash = req.session.flash || [];
    delete req.session.flash;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { loadContext };
