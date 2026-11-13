const express = require('express');
const bcrypt = require('bcryptjs');
const passport = require('passport');
const rateLimit = require('express-rate-limit');
const { User, Role } = require('../models');
const { requireGuest } = require('../middleware/guards');
const { createToken, hashToken } = require('../services/tokens');
const mailer = require('../services/mailer');
const { loginUser } = require('../services/session');
const { defaultRoleId } = require('../services/seed');
const { audit } = require('../services/audit');
const { isEmail, safeReturn } = require('../utils/format');
const { hasPermission } = require('../utils/permissions');
const { googleEnabled } = require('../config/passport');
const { Op } = require('sequelize');

const router = express.Router();
const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    req.flash('error', 'Too many attempts. Wait a few minutes and try again.');
    res.redirect(req.get('referer') || '/login');
  },
});

const page = (view, title, extra = {}) => ({ title, bare: true, errors: [], form: {}, googleHint: false, ...extra });

async function issueVerification(user) {
  const { raw, hash } = createToken();
  user.verifyTokenHash = hash;
  user.verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await user.save();
  try {
    await mailer.sendVerificationEmail(user, `${appUrl()}/verify-email/${raw}`);
  } catch (err) {
    console.error('[mail] verification email failed:', err.message);
  }
}

function landing(req, user) {
  const to = safeReturn(req.session.returnTo, hasPermission(user, 'dashboard.view') ? '/admin' : '/dashboard');
  delete req.session.returnTo;
  return to;
}

// ---------- Register ----------
// Remember where to send people after they sign in or sign up (only same-site paths)
function rememberNext(req) {
  const next = safeReturn(String(req.query.next || ''), null);
  if (next) req.session.returnTo = next;
}

router.get('/register', requireGuest, (req, res) => { rememberNext(req); return res.render('auth/register', page('register', 'Create your account')); });

router.post('/register', requireGuest, limiter, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm || '');

    const errors = [];
    if (name.length < 2 || name.length > 80) errors.push('Enter your full name.');
    if (!isEmail(email)) errors.push('Enter a valid email address.');
    if (password.length < 8) errors.push('Use a password with at least 8 characters.');
    if (password !== confirm) errors.push('The two passwords do not match.');
    if (errors.length) return res.status(400).render('auth/register', page('register', 'Create your account', { errors, form: { name, email } }));

    const existing = await User.findOne({ where: { email } });
    if (existing) {
      req.flash(
        'error',
        existing.passwordHash
          ? 'An account with this email already exists. Sign in instead.'
          : 'This email is already registered with Google. Use Continue with Google to sign in.'
      );
      return res.redirect('/login');
    }

    const user = await User.create({
      name,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      authProvider: 'local',
      roleId: await defaultRoleId(email),
    });
    await issueVerification(user);
    req.session.pendingEmail = email;
    return res.redirect('/verify-notice');
  } catch (err) {
    return next(err);
  }
});

// ---------- Email verification ----------
router.get('/verify-notice', (req, res) => {
  const email = req.session.pendingEmail;
  if (!email) return res.redirect('/login');
  return res.render('auth/verify-notice', page('verify', 'Check your email', { email }));
});

router.post('/resend-verification', limiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || req.session.pendingEmail || '').trim().toLowerCase();
    const user = email ? await User.findOne({ where: { email } }) : null;
    if (user && user.passwordHash && !user.emailVerified) await issueVerification(user);
    req.session.pendingEmail = email;
    req.flash('success', 'If that account still needs verifying, we have sent a new link.');
    return res.redirect('/verify-notice');
  } catch (err) {
    return next(err);
  }
});

router.get('/verify-email/:token', async (req, res, next) => {
  try {
    const user = await User.findOne({
      where: { verifyTokenHash: hashToken(req.params.token), verifyExpires: { [Op.gt]: new Date() } },
      include: [Role],
    });
    if (!user) {
      req.flash('error', 'That verification link is invalid or has expired. Request a new one.');
      return res.redirect(req.session.pendingEmail ? '/verify-notice' : '/login');
    }
    user.emailVerified = true;
    user.verifyTokenHash = null;
    user.verifyExpires = null;
    await user.save();
    if (user.status !== 'active') {
      req.flash('error', 'Your account is suspended. Contact support.');
      return res.redirect('/login');
    }
    await loginUser(req, user);
    req.flash('success', 'Email verified. Welcome to True Series Academy.');
    return res.redirect(landing(req, user));
  } catch (err) {
    return next(err);
  }
});

// ---------- Sign in ----------
router.get('/login', requireGuest, (req, res) => { rememberNext(req); return res.render('auth/login', page('login', 'Sign in')); });

router.post('/login', requireGuest, limiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = email ? await User.findOne({ where: { email }, include: [Role] }) : null;
    const fail = (msg, extra = {}) =>
      res.status(400).render('auth/login', page('login', 'Sign in', { errors: [msg], form: { email }, ...extra }));

    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      return fail('Incorrect email or password.');
    }

    // Account was created with Google and has no password: tell the person which method to use
    if (!user.passwordHash) {
      return fail('This account was created with Google, so it has no password. Use Continue with Google to sign in.', {
        googleHint: true,
      });
    }

    if (!(await bcrypt.compare(password, user.passwordHash))) return fail('Incorrect email or password.');
    if (user.status !== 'active') return fail('Your account is suspended. Contact support if you think this is a mistake.');

    if (!user.emailVerified) {
      req.session.pendingEmail = email;
      req.flash('info', 'Verify your email to sign in. You can request a new link below.');
      return res.redirect('/verify-notice');
    }

    await loginUser(req, user);
    return res.redirect(landing(req, user));
  } catch (err) {
    return next(err);
  }
});

// ---------- Google ----------
router.get('/auth/google', requireGuest, (req, res, next) => {
  if (!googleEnabled()) {
    req.flash('error', 'Google sign-in is not available right now.');
    return res.redirect('/login');
  }
  return passport.authenticate('google', { scope: ['profile', 'email'], session: false, prompt: 'select_account' })(req, res, next);
});

router.get('/auth/google/callback', (req, res, next) => {
  if (!googleEnabled()) return res.redirect('/login');
  return passport.authenticate('google', { session: false }, async (err, profile) => {
    if (err || !profile) {
      req.flash('error', 'Google sign-in was cancelled or failed. Please try again.');
      return res.redirect('/login');
    }
    try {
      const emailInfo = profile.emails && profile.emails[0];
      const email = emailInfo && emailInfo.value ? emailInfo.value.toLowerCase() : '';
      const verified = emailInfo && (emailInfo.verified === true || emailInfo.verified === 'true');
      const photo = profile.photos && profile.photos[0] ? profile.photos[0].value : null;
      if (!email || !verified) {
        req.flash('error', 'Your Google account does not have a verified email address.');
        return res.redirect('/login');
      }

      let user = await User.findOne({ where: { googleId: profile.id }, include: [Role] });
      let linked = false;

      if (!user) {
        user = await User.findOne({ where: { email }, include: [Role] });
        if (user) {
          // Existing email/password account: link Google to it.
          const wasVerified = user.emailVerified;
          user.googleId = profile.id;
          user.emailVerified = true;
          user.verifyTokenHash = null;
          user.verifyExpires = null;
          if (!user.avatarUrl && photo) user.avatarUrl = photo;
          if (!wasVerified) {
            // The password was set by someone who never proved they own this email: discard it.
            user.passwordHash = null;
            user.authProvider = 'google';
          }
          await user.save();
          linked = true;
        } else {
          const created = await User.create({
            name: profile.displayName || email.split('@')[0],
            email,
            googleId: profile.id,
            authProvider: 'google',
            emailVerified: true,
            avatarUrl: photo,
            roleId: await defaultRoleId(email),
          });
          user = await User.findByPk(created.id, { include: [Role] });
        }
      }

      if (user.status !== 'active') {
        req.flash('error', 'Your account is suspended. Contact support if you think this is a mistake.');
        return res.redirect('/login');
      }

      await loginUser(req, user);
      if (linked) req.flash('success', 'Google sign-in is now linked to your account.');
      return res.redirect(landing(req, user));
    } catch (e) {
      return next(e);
    }
  })(req, res, next);
});

// ---------- Password reset ----------
router.get('/forgot-password', requireGuest, (req, res) => res.render('auth/forgot', page('forgot', 'Reset your password')));

router.post('/forgot-password', requireGuest, limiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = isEmail(email) ? await User.findOne({ where: { email } }) : null;
    if (user) {
      try {
        if (!user.passwordHash) {
          await mailer.sendGoogleAccountNotice(user, `${appUrl()}/login`);
        } else {
          const { raw, hash } = createToken();
          user.resetTokenHash = hash;
          user.resetExpires = new Date(Date.now() + 60 * 60 * 1000);
          await user.save();
          await mailer.sendPasswordResetEmail(user, `${appUrl()}/reset-password/${raw}`);
        }
      } catch (err) {
        console.error('[mail] reset email failed:', err.message);
      }
    }
    req.flash('success', 'If an account exists for that email, we have sent instructions.');
    return res.redirect('/login');
  } catch (err) {
    return next(err);
  }
});

async function findByResetToken(token) {
  return User.findOne({ where: { resetTokenHash: hashToken(token), resetExpires: { [Op.gt]: new Date() } } });
}

router.get('/reset-password/:token', requireGuest, async (req, res, next) => {
  try {
    if (!(await findByResetToken(req.params.token))) {
      req.flash('error', 'That reset link is invalid or has expired. Request a new one.');
      return res.redirect('/forgot-password');
    }
    return res.render('auth/reset', page('reset', 'Choose a new password', { token: req.params.token }));
  } catch (err) {
    return next(err);
  }
});

router.post('/reset-password/:token', requireGuest, limiter, async (req, res, next) => {
  try {
    const user = await findByResetToken(req.params.token);
    if (!user) {
      req.flash('error', 'That reset link is invalid or has expired. Request a new one.');
      return res.redirect('/forgot-password');
    }
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm || '');
    const errors = [];
    if (password.length < 8) errors.push('Use a password with at least 8 characters.');
    if (password !== confirm) errors.push('The two passwords do not match.');
    if (errors.length) return res.status(400).render('auth/reset', page('reset', 'Choose a new password', { token: req.params.token, errors }));

    user.passwordHash = await bcrypt.hash(password, 12);
    user.resetTokenHash = null;
    user.resetExpires = null;
    user.emailVerified = true; // they received the link at this address
    await user.save();
    req.flash('success', 'Password updated. Sign in with your new password.');
    return res.redirect('/login');
  } catch (err) {
    return next(err);
  }
});

// ---------- Sign out / stop viewing as ----------
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

router.post('/impersonate/stop', async (req, res) => {
  if (req.session.impersonateId) {
    await audit(req, 'user.impersonate.stop', 'User', req.session.impersonateId);
    delete req.session.impersonateId;
    req.flash('success', 'You are back in your own account.');
  }
  res.redirect('/admin/users');
});

module.exports = router;
