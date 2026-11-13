const { hasPermission, canAccessAdmin } = require('../utils/permissions');

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  req.flash('info', 'Sign in to continue.');
  return res.redirect('/login');
}

function requireGuest(req, res, next) {
  if (req.user) return res.redirect('/dashboard');
  return next();
}

function requirePermission(...permissions) {
  return (req, res, next) => {
    if (req.user && permissions.every((p) => hasPermission(req.user, p))) return next();
    return res.status(403).render('errors/403', { title: 'Access denied' });
  };
}

function requireAdminAccess(req, res, next) {
  if (canAccessAdmin(req.user)) return next();
  return res.status(403).render('errors/403', { title: 'Access denied' });
}

// Students can look around while "viewing as", but cannot take actions in someone else's name.
function noImpersonation(req, res, next) {
  if (res.locals.isImpersonating) {
    req.flash('error', 'You are viewing as another user, so actions are switched off.');
    return res.redirect(req.get('referer') || '/dashboard');
  }
  return next();
}

module.exports = { requireAuth, requireGuest, requirePermission, requireAdminAccess, noImpersonation };
