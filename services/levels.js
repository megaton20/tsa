// Learning levels. Nothing is stored: XP is counted from what a person has actually done.
const { fn } = require('sequelize');
const { Attendance, RecordingView, Certificate } = require('../models');

const XP = { attend: 10, recording: 5, certificate: 100 };
const LEVELS = [
  { n: 1, name: 'Newcomer', at: 0 },
  { n: 2, name: 'Explorer', at: 50 },
  { n: 3, name: 'Learner', at: 150 },
  { n: 4, name: 'Achiever', at: 300 },
  { n: 5, name: 'Scholar', at: 500 },
  { n: 6, name: 'Master', at: 800 },
];

function levelFromXp(xp) {
  let current = LEVELS[0];
  LEVELS.forEach((l) => {
    if (xp >= l.at) current = l;
  });
  const next = LEVELS.find((l) => l.at > xp) || null;
  const pct = next ? Math.round(((xp - current.at) / (next.at - current.at)) * 100) : 100;
  return { ...current, xp, next, pct, toNext: next ? next.at - xp : 0 };
}

const countBy = async (Model, userIds, extra = {}) => {
  const rows = await Model.findAll({ attributes: ['userId', [fn('COUNT', '*'), 'n']], where: { userId: userIds, ...extra }, group: ['userId'], raw: true });
  const map = {};
  rows.forEach((r) => (map[r.userId] = Number(r.n)));
  return map;
};

// For many people at once (one query per kind of activity)
async function statsFor(userIds) {
  const out = {};
  if (!userIds.length) return out;
  const [att, rec, cert] = await Promise.all([
    countBy(Attendance, userIds),
    countBy(RecordingView, userIds),
    countBy(Certificate, userIds, { revokedAt: null }),
  ]);
  userIds.forEach((id) => {
    const attended = att[id] || 0;
    const recordings = rec[id] || 0;
    const certificates = cert[id] || 0;
    const xp = attended * XP.attend + recordings * XP.recording + certificates * XP.certificate;
    out[id] = { attended, recordings, certificates, xp, level: levelFromXp(xp) };
  });
  return out;
}

async function statsForUser(userId) {
  return (await statsFor([userId]))[userId];
}

module.exports = { XP, LEVELS, levelFromXp, statsFor, statsForUser };
