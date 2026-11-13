const crypto = require('crypto');

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function verifyCsrf(req, res, next) {
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (safeEqual(sent, req.session.csrf)) return next();
  req.flash && req.flash('error', 'Your session expired. Please try again.');
  if (req.accepts('html')) return res.redirect(req.get('referer') || '/');
  return res.status(403).json({ error: 'Invalid CSRF token' });
}

// Global guard. Multipart forms are verified inside their route, after multer has parsed the body.
function csrf(req, res, next) {
  if (req.path === '/webhooks/paystack') return next(); // authenticated by Paystack's signature
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.is('multipart/form-data')) return next();
  return verifyCsrf(req, res, next);
}

module.exports = { csrf, verifyCsrf };
