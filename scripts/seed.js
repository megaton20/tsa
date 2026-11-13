#!/usr/bin/env node
/*
 * Fills a DEVELOPMENT database with realistic demo data so every screen has something to show.
 *
 *   npm run seed            add demo data (safe to run again: it never duplicates rows)
 *   npm run seed:reset      wipe every table first, then add demo data
 *
 * Refuses to run when NODE_ENV=production unless you pass --force, and refuses to wipe a database that
 * is not on this computer unless you also pass --yes.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const models = require('../models');
const { seedRoles } = require('../services/seed');
const { issue } = require('../services/certificates');
const { syncTasks } = require('../services/tasks');

const { sequelize, Role, User, Program, Cohort, ProgramStaff, QuizQuestion, Application, Enrollment, Payment, Session, Attendance, Recording, RecordingView, HeroSlide, SiteSetting } = models;

const PASSWORD = process.env.SEED_PASSWORD || 'Password123!';
const H = 60 * 60 * 1000;
const D = 24 * H;
const ago = (ms) => new Date(Date.now() - ms);
const ahead = (ms) => new Date(Date.now() + ms);
const DEMO_VIDEO = 'jNQXAC9IVRw'; // a short public YouTube video, just a placeholder to show the player

// Create it if it is missing, otherwise leave it alone
async function ensure(Model, where, defaults = {}) {
  const [row] = await Model.findOrCreate({ where, defaults: { ...where, ...defaults } });
  return row;
}

async function run({ reset = false } = {}) {
  await sequelize.authenticate();
  if (reset) {
    console.log('Wiping every table...');
    await sequelize.sync({ force: true });
  } else {
    await sequelize.sync({ alter: true });
  }
  await seedRoles();
  const role = {};
  for (const r of await Role.findAll()) role[r.slug] = r;
  const hash = await bcrypt.hash(PASSWORD, 10);

  // ---------- people ----------
  const people = {};
  const person = async (key, email, name, opts = {}) => {
    const u = await ensure(User, { email }, {
      name,
      passwordHash: opts.google ? null : hash,
      authProvider: opts.google ? 'google' : 'local',
      googleId: opts.google ? 'seed-google-1' : null,
      emailVerified: true,
      roleId: role[opts.role || 'student'].id,
      timezone: opts.tz || 'Africa/Lagos',
      timezoneConfirmed: Boolean(opts.tz),
      whatsappPromptSeen: true,
    });
    people[key] = u;
    return u;
  };
  const owner = (process.env.SUPERADMIN_EMAIL || 'admin@tsa.test').toLowerCase();
  await person('owner', owner, 'Mega Admin', { role: 'superadmin' });
  await person('ops', 'ops@tsa.test', 'Ops Admin', { role: 'admin' });
  await person('manager', 'manager@tsa.test', 'Mary Manager');
  await person('instructor', 'instructor@tsa.test', 'Ike Instructor');
  await person('moderator', 'moderator@tsa.test', 'Mo Moderator');
  const studentList = [
    ['ada', 'Ada Okafor'], ['bola', 'Bola Adeyemi'], ['chidi', 'Chidi Nwosu'], ['dayo', 'Dayo Balogun'], ['ebube', 'Ebube Eze'],
    ['femi', 'Femi Ogunleye'], ['gozie', 'Gozie Obi'], ['hauwa', 'Hauwa Bello'], ['ife', 'Ife Akinola'], ['jide', 'Jide Salami'],
    ['kemi', 'Kemi Adebayo'], ['lola', 'Lola Fashola'],
  ];
  for (const [key, name] of studentList) await person(key, `${key}@tsa.test`, name, key === 'jide' ? { tz: 'Europe/London' } : {});
  await person('google', 'google.user@tsa.test', 'Tunde Google', { google: true });

  // ---------- site settings and banners ----------
  const settings = {
    whatsappChannelUrl: 'https://whatsapp.com/channel/tsa-demo', whatsappGroupUrl: 'https://chat.whatsapp.com/tsa-demo',
    telegramUrl: 'https://t.me/tsa_demo', supportEmail: 'support@tsa.test',
  };
  for (const [key, value] of Object.entries(settings)) await SiteSetting.upsert({ key, value });

  // ---------- programs ----------
  const prog = {};
  const makeProgram = async (key, slug, data) => (prog[key] = await ensure(Program, { slug }, data));
  await makeProgram('da', 'data-analytics-bootcamp', {
    title: 'Data Analytics Bootcamp', category: 'Data', tags: ['excel', 'sql', 'dashboards'], status: 'published',
    summary: 'Turn raw numbers into decisions with Excel, SQL and dashboards, taught live over eight weeks.',
    description: 'You will learn to clean data, ask good questions of it, and present the answers so people act on them.\n\nEvery week has a live session, a practical task and a recording to rewatch. Scholarship seats cover most of the fee.',
  });
  await makeProgram('fe', 'frontend-web-development', {
    title: 'Frontend Web Development', category: 'Tech', tags: ['html', 'css', 'javascript'], status: 'published',
    summary: 'Build real, responsive websites with HTML, CSS and JavaScript, from your first page to a finished project.',
    description: 'A hands-on path from zero to your first deployed site.\n\nYou will build something every week and get feedback in the live sessions.',
  });
  await makeProgram('dm', 'digital-marketing-essentials', {
    title: 'Digital Marketing Essentials', category: 'Marketing', tags: ['social media', 'seo'], status: 'published',
    summary: 'A free community cohort covering social media, content and search basics.',
    description: 'Join the community to follow the lessons and swap ideas with other learners.',
  });
  await makeProgram('cs', 'cybersecurity-basics', {
    title: 'Cybersecurity Basics', category: 'Tech', tags: ['security'], status: 'draft',
    summary: 'A draft program, visible only to your team.', description: 'Still being planned.',
  });

  // ---------- team (program-scoped roles) ----------
  const staff = async (program, user, slug) => ensure(ProgramStaff, { programId: program.id, userId: user.id }, { roleId: role[slug].id });
  await staff(prog.da, people.manager, 'manager');
  await staff(prog.fe, people.manager, 'manager');
  await staff(prog.da, people.instructor, 'instructor');
  await staff(prog.fe, people.instructor, 'instructor');
  await staff(prog.da, people.moderator, 'moderator');

  // ---------- quizzes ----------
  const quiz = async (program, items) => {
    let order = 1;
    for (const [prompt, options, correct] of items) await ensure(QuizQuestion, { programId: program.id, prompt }, { options, correctIndex: correct, points: 1, sortOrder: order++ });
  };
  await quiz(prog.da, [
    ['Which function adds up a column of numbers in Excel?', ['SUM', 'COUNTIF', 'VLOOKUP', 'ROUND'], 0],
    ['In SQL, which clause filters rows?', ['ORDER BY', 'WHERE', 'GROUP BY', 'LIMIT'], 1],
    ['A pivot table is mainly used to', ['Format cells', 'Summarise data', 'Encrypt a file', 'Draw shapes'], 1],
    ['The average of 2, 4 and 9 is', ['4', '5', '6', '15'], 1],
    ['Which chart best shows change over time?', ['Pie chart', 'Line chart', 'Scatter of names', 'Table of colours'], 1],
    ['Duplicate rows in a dataset should usually be', ['Doubled', 'Reviewed and removed', 'Hidden in a note', 'Left alone always'], 1],
  ]);
  await quiz(prog.fe, [
    ['Which tag makes the largest heading?', ['<h6>', '<h1>', '<head>', '<p>'], 1],
    ['CSS stands for', ['Cascading Style Sheets', 'Computer Style System', 'Creative Site Scripts', 'Coded Style Syntax'], 0],
    ['Which one stores a value in JavaScript?', ['let', 'if', 'else', 'return'], 0],
    ['The browser tool for inspecting a page is called', ['Developer Tools', 'Task Manager', 'Control Panel', 'File Explorer'], 0],
    ['Which unit scales with the screen width?', ['px', 'vw', 'pt', 'cm'], 1],
  ]);

  // ---------- cohorts ----------
  const cohort = {};
  const makeCohort = async (key, program, name, data) => (cohort[key] = await ensure(Cohort, { programId: program.id, name }, data));
  await makeCohort('da1', prog.da, 'Cohort 1 (finished)', {
    status: 'completed', enrollmentMode: 'application', fullFeeKobo: 5000000, scholarshipPercent: 90, seats: 12,
    startsAt: ago(60 * D), endsAt: ago(10 * D), attendanceRequiredPercent: 75, sponsorName: 'Demo Sponsor Ltd',
  });
  await makeCohort('da2', prog.da, 'Cohort 2 (applications open)', {
    status: 'open', enrollmentMode: 'application', fullFeeKobo: 5000000, scholarshipPercent: 90, seats: 3,
    startsAt: ahead(14 * D), endsAt: ahead(70 * D), applicationDeadline: ahead(10 * D), offerWindowHours: 72, passMark: 70, graceMark: 60,
    sponsorName: 'Demo Sponsor Ltd',
  });
  await makeCohort('fe3', prog.fe, 'Cohort 3 (running, free)', {
    status: 'open', enrollmentMode: 'free', fullFeeKobo: 0, scholarshipPercent: 0, seats: 30, startsAt: ago(10 * D), endsAt: ahead(40 * D),
  });
  await makeCohort('fe4', prog.fe, 'Cohort 4 (paid)', {
    status: 'open', enrollmentMode: 'pay', fullFeeKobo: 1500000, scholarshipPercent: 0, seats: 20, startsAt: ahead(21 * D), endsAt: ahead(80 * D),
  });
  await makeCohort('dm1', prog.dm, 'Community cohort', {
    status: 'open', enrollmentMode: 'community', whatsappUrl: 'https://chat.whatsapp.com/tsa-marketing-demo', telegramUrl: 'https://t.me/tsa_marketing_demo',
  });
  await makeCohort('cs1', prog.cs, 'Draft cohort', { status: 'draft', enrollmentMode: 'application', seats: 10 });

  const enrol = async (c, user, extra = {}) => ensure(Enrollment, { cohortId: c.id, userId: user.id }, { status: 'active', source: 'free', enrolledAt: ago(30 * D), ...extra });
  const mkSession = async (c, title, startsAt, minutes, extra = {}) =>
    ensure(Session, { cohortId: c.id, title }, {
      startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60000), joinOpensMinutesBefore: 15, status: 'scheduled',
      meetLink: 'https://meet.google.com/abc-defg-hij', leadId: people.instructor.id, ...extra,
    });
  const present = async (session, user, extra = {}) => {
    const t = new Date(session.startsAt.getTime() - 4 * 60000);
    return ensure(Attendance, { sessionId: session.id, userId: user.id }, { method: 'join', firstJoinedAt: t, lastJoinedAt: t, joinCount: 1, ip: '127.0.0.1', userAgent: 'seed', ...extra });
  };

  // ---------- Data Analytics, Cohort 1: finished, with attendance, recordings and certificates ----------
  const da1Students = ['ada', 'bola', 'chidi', 'dayo', 'ebube'];
  for (const k of da1Students) await enrol(cohort.da1, people[k], { source: 'scholarship' });
  const da1Sessions = [];
  for (let i = 0; i < 6; i += 1) da1Sessions.push(await mkSession(cohort.da1, `Week ${i + 1}`, ago((56 - i * 7) * D), 90));
  const attendedDa1 = { ada: 6, bola: 5, chidi: 4, dayo: 6, ebube: 5 }; // chidi (67%) is below the 75% rule
  for (const k of da1Students) for (let i = 0; i < attendedDa1[k]; i += 1) await present(da1Sessions[i], people[k]);
  for (let i = 0; i < 3; i += 1) await ensure(Recording, { cohortId: cohort.da1.id, title: `Week ${i + 1} recording` }, { sessionId: da1Sessions[i].id, youtubeId: DEMO_VIDEO, sortOrder: i + 1, status: 'published', description: 'Recorded live. Rewatch it any time.' });
  const heldPercent = (n) => Math.round((n / 6) * 100);
  for (const k of ['ada', 'bola', 'dayo', 'ebube']) await issue({ cohort: cohort.da1, program: prog.da, user: people[k], percent: heldPercent(attendedDa1[k]) });
  const recs = await Recording.findAll({ where: { cohortId: cohort.da1.id } });
  if (recs[0]) await ensure(RecordingView, { recordingId: recs[0].id, userId: people.ada.id }, { firstViewedAt: ago(3 * D), lastViewedAt: ago(1 * D), viewCount: 2 });

  // ---------- Data Analytics, Cohort 2: every application state, seats full ----------
  const detail = (n) => ({ phone: `0803000000${n}`, state: 'Cross River', education: 'HND / Bachelor\u2019s degree', occupation: 'Student', motivation: 'I want to learn how to use data to make better decisions at work and in my community.' });
  const apply = async (k, n, status, extra = {}) =>
    ensure(Application, { cohortId: cohort.da2.id, userId: people[k].id }, { status, details: detail(n), submittedAt: ago(3 * D), quizSubmittedAt: ago(3 * D), quizAnswers: {}, ...extra });
  await apply('ada', 1, 'offered', { scorePercent: 85, offerType: 'auto', offeredAt: ago(1 * D), offerExpiresAt: ahead(2 * D) });
  await apply('hauwa', 2, 'offered', { scorePercent: 92, offerType: 'auto', offeredAt: ago(2 * D), offerExpiresAt: ahead(1 * D) });
  await apply('bola', 3, 'in_review', { scorePercent: 65, reviewReason: 'grace' });
  await apply('chidi', 4, 'waitlisted', { scorePercent: 78 });
  await apply('dayo', 5, 'not_selected', { scorePercent: 40 });
  await apply('femi', 6, 'expired', { scorePercent: 80, offerType: 'auto', offeredAt: ago(6 * D), offerExpiresAt: ago(3 * D) });
  await apply('gozie', 7, 'in_progress', { scorePercent: null, quizSubmittedAt: null, quizAnswers: null });
  const ebubeApp = await apply('ebube', 8, 'accepted', { scorePercent: 88, offerType: 'auto', acceptedAt: ago(1 * D) });
  const ebubePay = await ensure(Payment, { reference: 'SEED-DA2-EBUBE' }, { userId: people.ebube.id, cohortId: cohort.da2.id, applicationId: ebubeApp.id, amountKobo: 500000, status: 'success', purpose: 'seat', channel: 'card', paidAt: ago(1 * D) });
  await enrol(cohort.da2, people.ebube, { source: 'scholarship', applicationId: ebubeApp.id, paymentId: ebubePay.id, enrolledAt: ago(1 * D) });

  // ---------- Frontend, Cohort 3: running, with a session live right now ----------
  const fe3Students = ['ada', 'bola', 'chidi', 'femi', 'gozie', 'hauwa', 'ife', 'jide'];
  for (const k of fe3Students) await enrol(cohort.fe3, people[k], { source: 'free', enrolledAt: ago(10 * D) });
  const s1 = await mkSession(cohort.fe3, 'Week 1: HTML foundations', ago(7 * D), 90);
  const s2 = await mkSession(cohort.fe3, 'Week 2: CSS and layout', ago(2 * D), 90);
  const live = await mkSession(cohort.fe3, 'Live now: JavaScript basics', ago(5 * 60000), 90);
  await mkSession(cohort.fe3, 'Week 4: Forms and validation', ahead(1 * D), 90);
  await mkSession(cohort.fe3, 'Week 5: Fetching data (no link yet)', ahead(3 * D), 90, { meetLink: null });
  await mkSession(cohort.fe3, 'Week 6: Project clinic (cancelled)', ahead(5 * D), 60, { status: 'cancelled' });
  for (const k of ['ada', 'bola', 'chidi', 'femi', 'gozie', 'hauwa']) await present(s1, people[k]);
  await present(s1, people.ife, { method: 'manual', joinCount: 0, note: 'Link problem, confirmed by the instructor', markedById: people.instructor.id });
  for (const k of ['ada', 'bola', 'femi']) await present(s2, people[k]);
  await present(live, people.hauwa);
  await ensure(Recording, { cohortId: cohort.fe3.id, title: 'Week 1: HTML foundations' }, { sessionId: s1.id, youtubeId: DEMO_VIDEO, sortOrder: 1, status: 'published' });
  await ensure(Recording, { cohortId: cohort.fe3.id, title: 'Week 2: CSS and layout' }, { sessionId: s2.id, youtubeId: DEMO_VIDEO, sortOrder: 2, status: 'published' });

  // ---------- Frontend, Cohort 4: paid enrollment ----------
  const jidePay = await ensure(Payment, { reference: 'SEED-FE4-JIDE' }, { userId: people.jide.id, cohortId: cohort.fe4.id, amountKobo: 1500000, status: 'success', purpose: 'enrollment', channel: 'card', paidAt: ago(2 * D) });
  await enrol(cohort.fe4, people.jide, { source: 'paid', paymentId: jidePay.id, enrolledAt: ago(2 * D) });
  await ensure(Payment, { reference: 'SEED-FE4-KEMI' }, { userId: people.kemi.id, cohortId: cohort.fe4.id, amountKobo: 1500000, status: 'pending', purpose: 'enrollment' });
  await ensure(Payment, { reference: 'SEED-FE4-LOLA' }, { userId: people.lola.id, cohortId: cohort.fe4.id, amountKobo: 1500000, status: 'failed', purpose: 'enrollment', note: 'Card declined' });

  // ---------- homepage banners ----------
  const slide = (title, data) => ensure(HeroSlide, { title }, { isActive: true, textOverlay: true, ...data });
  await slide('Data Analytics Bootcamp: scholarship applications open', { subtitle: 'Eight live weeks. Apply, take a short quiz, and get an offer by email.', badge: 'Scholarship', ctaType: 'details', ctaLabel: 'Apply now', ctaUrl: `/programs/${prog.da.slug}`, programId: prog.da.id, sortOrder: 1 });
  await slide('Learn to build websites, starting this week', { subtitle: 'Frontend Web Development is open and free to join.', badge: 'Free', ctaType: 'details', ctaLabel: 'Enroll for free', ctaUrl: `/programs/${prog.fe.slug}`, programId: prog.fe.id, sortOrder: 2 });
  await slide('Join the marketing community', { subtitle: 'Free lessons and a friendly group on WhatsApp and Telegram.', badge: 'Community', ctaType: 'whatsapp', ctaLabel: 'Join on WhatsApp', ctaUrl: 'https://chat.whatsapp.com/tsa-marketing-demo', sortOrder: 3 });

  // The system notices the session without a meeting link and the application waiting for review
  await syncTasks();

  return { password: PASSWORD, owner };
}

function printSummary({ password, owner }) {
  const rows = [
    [owner, 'Superadmin: sees and does everything'],
    ['ops@tsa.test', 'Admin'],
    ['manager@tsa.test', 'Program manager of Data Analytics and Frontend (reviews the grace application)'],
    ['instructor@tsa.test', 'Instructor on both programs (sessions, attendance, recordings)'],
    ['moderator@tsa.test', 'Moderator on Data Analytics (attendance list only)'],
    ['ada@tsa.test', 'Student with a finished cohort + certificate, an open seat offer, and a running cohort'],
    ['bola@tsa.test', 'Student whose application is in the grace band, waiting for the manager'],
    ['chidi@tsa.test', 'Waitlisted, and below the attendance rule in the finished cohort (no certificate)'],
    ['hauwa@tsa.test', 'Has an offer expiring tomorrow, and is in the live session'],
    ['jide@tsa.test', 'Paid for Cohort 4, time zone Europe/London'],
    ['google.user@tsa.test', 'Signed up with Google: password sign-in tells them to use Google'],
  ];
  const w = Math.max(...rows.map((r) => r[0].length));
  console.log('\nDone. Every password account uses:  ' + password + '\n');
  rows.forEach(([e, d]) => console.log(`  ${e.padEnd(w)}  ${d}`));
  console.log('\nThings to try:\n  - Sign in as ada@tsa.test: press Join on "Live now: JavaScript basics" (it records attendance and opens the pasted link).\n  - Sign in as manager@tsa.test: approve Bola with grace; see the session with no meeting link under "Needs attention".\n  - Mark Data Analytics Cohort 1 certificates: Chidi shows "Issue anyway" with a reason.\n  - Open /verify and enter a certificate code from Ada\'s certificates page.\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const url = process.env.DATABASE_URL || '';
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  if (process.env.NODE_ENV === 'production' && !args.includes('--force')) {
    console.error('NODE_ENV is production. The seed script is for development databases. Add --force if you really mean it.');
    process.exit(1);
  }
  if (reset && !local && !args.includes('--yes')) {
    console.error('--reset would wipe a database that is not on this computer. Add --yes if you are sure.');
    process.exit(1);
  }
  run({ reset })
    .then((info) => {
      printSummary(info);
      return sequelize.close();
    })
    .catch(async (err) => {
      console.error('Seed failed:', err);
      await sequelize.close().catch(() => {});
      process.exit(1);
    });
}

module.exports = { run };
