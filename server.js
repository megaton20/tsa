require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const helmet = require('helmet');
const passport = require('passport');

const { sequelize } = require('./models');
const { seedRoles, promoteSuperadmin } = require('./services/seed');
const { configurePassport } = require('./config/passport');
const { csrf } = require('./middleware/csrf');
const { loadContext } = require('./middleware/context');
const { startJobs } = require('./jobs');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

if (isProd && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required in production');
}

app.set('trust proxy', 1);

// Cold endpoint for keep-alive pings and host health checks. It sits before the session, the
// database and every other middleware, so it never touches Postgres and never sets a cookie.
app.all(['/ping', '/healthz'], (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).type('text/plain').send(req.method === 'HEAD' ? undefined : 'ok');
});
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// CSP is off while Tailwind runs from its CDN script. Turn it on after switching to a built stylesheet.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ verify: (req, res, buf) => { if (req.originalUrl === '/webhooks/paystack') req.rawBody = buf; } }));

const store = new SequelizeStore({ db: sequelize, tableName: 'Sessions' });
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-only-secret',
    store,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 14 * 24 * 60 * 60 * 1000 },
  })
);

configurePassport();
app.use(passport.initialize());
app.use(csrf);
app.use(loadContext);

app.use('/', require('./routes/public'));
app.use('/', require('./routes/programs'));
app.use('/', require('./routes/sessions'));
app.use('/', require('./routes/learning'));
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/account'));
app.use('/admin', require('./routes/admin'));
app.use('/admin', require('./routes/adminPrograms'));
app.use('/admin', require('./routes/adminSessions'));
app.use('/admin', require('./routes/adminLearning'));

app.use((req, res) => res.status(404).render('errors/404', { title: 'Page not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return;
  const fallback = { css: require('./config/css').cssInfo(), appName: 'True Series Academy', csrfToken: '', currentUser: null, canAdmin: false, can: () => false, settings: {}, flash: [], showCommunityPrompt: false, isImpersonating: false, googleEnabled: false };
  res.status(500).render('errors/500', { ...fallback, ...res.locals, title: 'Something went wrong' });
});

async function start() {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });
  await store.sync();
  await seedRoles();
  await promoteSuperadmin();
  startJobs();
  app.listen(PORT, () => console.log(`True Series Academy running on http://localhost:${PORT}`));
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
