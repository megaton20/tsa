const { Op } = require('sequelize');
const { Session, Cohort, Program, Enrollment, User } = require('../models');
const mailer = require('./mailer');
const { fmtWhen } = require('../utils/format');

const HOUR = 60 * 60 * 1000;
const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

async function remindStudents(session, kind) {
  const cohort = session.Cohort;
  const label = `${cohort.Program.title} (${cohort.name})`;
  const enrollments = await Enrollment.findAll({
    where: { cohortId: cohort.id, status: 'active' },
    include: [{ model: User, where: { reminderEmails: true, status: 'active' } }],
  });
  const send = async (e) => {
    const user = e.User;
    const when = fmtWhen(session.startsAt, user.timezone);
    const body =
      kind === 'hour'
        ? `${user.name.split(' ')[0]}, "${session.title}" starts at ${when}. Open the session page and press Join once it opens (${session.joinOpensMinutesBefore} minutes before the start). Joining from the site is how your attendance is recorded.`
        : `${user.name.split(' ')[0]}, a reminder that "${session.title}" for ${label} is coming up: ${when}. On the day, open the session page and press Join so your attendance is recorded.`;
    try {
      await mailer.sendNotice({
        user,
        subject: kind === 'hour' ? `Starting within the hour: ${session.title}` : `Tomorrow: ${session.title}`,
        heading: kind === 'hour' ? 'Your session starts soon' : 'Session reminder',
        body,
        buttonText: 'Open the session',
        buttonUrl: `${appUrl()}/sessions/${session.id}`,
        footnote: 'You can turn session reminders off on your account page.',
      });
    } catch (err) {
      console.error('[reminders] email failed:', err.message);
    }
  };
  for (let i = 0; i < enrollments.length; i += 10) await Promise.all(enrollments.slice(i, i + 10).map(send));
  return enrollments.length;
}

// Runs every few minutes. A session is claimed with a conditional update first, so two server
// instances never email the same cohort twice.
async function sendReminders() {
  const now = new Date();
  const include = [{ model: Cohort, include: [Program] }];
  let sent = 0;

  const soon = await Session.findAll({
    where: { status: 'scheduled', remindedHourAt: null, startsAt: { [Op.gt]: now, [Op.lte]: new Date(now.getTime() + HOUR) } },
    include,
  });
  for (const s of soon) {
    const [claimed] = await Session.update({ remindedHourAt: now }, { where: { id: s.id, remindedHourAt: null } });
    if (claimed && ['open', 'closed'].includes(s.Cohort.status)) sent += await remindStudents(s, 'hour');
  }

  const tomorrow = await Session.findAll({
    where: { status: 'scheduled', remindedDayAt: null, startsAt: { [Op.gt]: now, [Op.lte]: new Date(now.getTime() + 24 * HOUR) } },
    include,
  });
  for (const s of tomorrow) {
    const [claimed] = await Session.update({ remindedDayAt: now }, { where: { id: s.id, remindedDayAt: null } });
    // Short notice: the one-hour reminder is enough
    const tooSoon = new Date(s.startsAt).getTime() - now.getTime() < 3 * HOUR;
    if (claimed && !tooSoon && ['open', 'closed'].includes(s.Cohort.status)) sent += await remindStudents(s, 'day');
  }
  return sent;
}

module.exports = { sendReminders };
