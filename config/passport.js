const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');

const googleEnabled = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

function configurePassport() {
  if (!googleEnabled()) {
    console.warn('[auth] Google sign-in disabled: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
    return;
  }
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${process.env.APP_URL || 'http://localhost:3000'}/auth/google/callback`,
        state: true,
      },
      (accessToken, refreshToken, profile, done) => done(null, profile)
    )
  );
}

module.exports = { configurePassport, googleEnabled };
