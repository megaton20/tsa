const { Op } = require('sequelize');
const { Session, Attendance, Enrollment, User } = require('../models');

const MIN = 60 * 1000;

// Where a session is in its life, from the student's point of view.
function windowFor(session, now = new Date()) {
  if (session.status === 'cancelled') return { state: 'cancelled' };
  const start = new Date(session.startsAt);
  const end = new Date(session.endsAt);
  const before = session.joinOpensMinutesBefore === undefined || session.joinOpensMinutesBefore === null ? 15 : session.joinOpensMinutesBefore;
  const opens = new Date(start.getTime() - before * MIN);
  if (now < opens) return { state: 'upcoming', opens, start, end };
  if (now <= end) return { state: 'open', opens, start, end };
  return { state: 'ended', opens, start, end };
}

// First press creates the attendance record, later presses only count. Called only after every check passed.
async function recordJoin(session, user, req) {
  const now = new Date();
  const [row, created] = await Attendance.findOrCreate({
    where: { sessionId: session.id, userId: user.id },
    defaults: { method: 'join', firstJoinedAt: now, lastJoinedAt: now, joinCount: 1, ip: req.ip, userAgent: String(req.get('user-agent') || '').slice(0, 255) },
  });
  if (!created) {
    row.lastJoinedAt = now;
    row.joinCount += 1;
    if (!row.firstJoinedAt) row.firstJoinedAt = now;
    await row.save();
  }
  return row;
}

const ENROLLED = ['active', 'suspended', 'completed'];

// One student's attendance across a cohort. Only sessions that have finished count as "held".
async function studentAttendance(cohortId, userId, now = new Date()) {
  const sessions = await Session.findAll({ where: { cohortId, status: 'scheduled' }, order: [['startsAt', 'ASC']] });
  const rows = sessions.length ? await Attendance.findAll({ where: { userId, sessionId: sessions.map((s) => s.id) } }) : [];
  const marks = {};
  rows.forEach((r) => (marks[r.sessionId] = r));
  const held = sessions.filter((s) => new Date(s.endsAt) < now);
  const attended = held.filter((s) => marks[s.id]).length;
  return { sessions, marks, held: held.length, attended, percent: held.length ? Math.round((attended / held.length) * 100) : null };
}

// Everyone in a cohort against every session, for the manager's matrix and the CSV export.
async function cohortAttendance(cohortId, now = new Date()) {
  const [sessions, enrollments] = await Promise.all([
    Session.findAll({ where: { cohortId, status: 'scheduled' }, order: [['startsAt', 'ASC']] }),
    Enrollment.findAll({ where: { cohortId, status: { [Op.in]: ENROLLED } }, include: [User], order: [[User, 'name', 'ASC']] }),
  ]);
  const rows = sessions.length ? await Attendance.findAll({ where: { sessionId: sessions.map((s) => s.id) } }) : [];
  const byUser = {};
  rows.forEach((r) => {
    byUser[r.userId] = byUser[r.userId] || {};
    byUser[r.userId][r.sessionId] = r;
  });
  const held = sessions.filter((s) => new Date(s.endsAt) < now);
  const students = enrollments.map((e) => {
    const marks = byUser[e.userId] || {};
    const attended = held.filter((s) => marks[s.id]).length;
    return { enrollment: e, user: e.User, marks, attended, percent: held.length ? Math.round((attended / held.length) * 100) : null };
  });
  return { sessions, held, students };
}

module.exports = { windowFor, recordJoin, studentAttendance, cohortAttendance, ENROLLED };
