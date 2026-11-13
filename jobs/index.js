const cron = require('node-cron');
const { expireOffers } = require('../services/enrollment');
const { sendReminders } = require('../services/reminders');
const { syncTasks, notifyTasks } = require('../services/tasks');

function guard(name, fn) {
  return async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[cron] ${name} failed:`, err.message);
    }
  };
}

// Safe to run on several instances: every state change is a conditional update.
function startJobs() {
  if (process.env.ENABLE_CRON === 'false') return;
  cron.schedule('*/10 * * * *', guard('expireOffers', async () => {
    const n = await expireOffers();
    if (n) console.log(`[cron] released seats on ${n} cohort(s)`);
  }));
  cron.schedule('*/5 * * * *', guard('reminders', async () => {
    const n = await sendReminders();
    if (n) console.log(`[cron] sent ${n} session reminder(s)`);
  }));
  cron.schedule('*/15 * * * *', guard('tasks', async () => {
    await syncTasks();
    await notifyTasks();
  }));
  console.log('[cron] scheduled: offer expiry (10 min), session reminders (5 min), task sync and nudges (15 min)');
}

module.exports = { startJobs };
