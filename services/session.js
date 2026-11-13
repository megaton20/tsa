const { getCookie } = require('../utils/format');

// Starts a fresh session for the user (prevents session fixation) and keeps the return URL.
function loginUser(req, user) {
  const returnTo = req.session.returnTo;
  const seenCookie = getCookie(req, 'tsa_wa_seen') === '1';
  return new Promise((resolve, reject) => {
    req.session.regenerate(async (err) => {
      if (err) return reject(err);
      try {
        req.session.userId = user.id;
        if (returnTo) req.session.returnTo = returnTo;
        user.lastLoginAt = new Date();
        // The community prompt is shown once per person: carry over a visitor's "seen" state
        if (seenCookie) user.whatsappPromptSeen = true;
        await user.save();
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}

module.exports = { loginUser };
