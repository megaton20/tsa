const crypto = require('crypto');
const { Certificate, Enrollment, Cohort, Program, User } = require('../models');
const { cohortAttendance } = require('./sessions');
const mailer = require('./mailer');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I so codes are easy to read out
const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const pick = (n) => Array.from({ length: n }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');

async function uniqueCode() {
  for (let i = 0; i < 10; i += 1) {
    const code = `TSA-${pick(4)}-${pick(4)}`;
    if (!(await Certificate.findOne({ where: { code } }))) return code;
  }
  throw new Error('Could not create a unique certificate code');
}

// "tsa k7pq 2m9x", "TSAK7PQ2M9X" and "TSA-K7PQ-2M9X" all mean the same code
function normalizeCode(input) {
  const s = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^TSA[A-Z0-9]{8}$/.test(s) ? `TSA-${s.slice(3, 7)}-${s.slice(7)}` : null;
}

// Needs at least one held session; the student must meet the cohort's attendance rule
const isEligible = (cohort, percent, heldCount) => heldCount > 0 && percent !== null && percent >= cohort.attendanceRequiredPercent;

async function issue({ cohort, program, user, percent, issuedById = null, note = null }) {
  const existing = await Certificate.findOne({ where: { cohortId: cohort.id, userId: user.id } });
  if (existing) return { certificate: existing, created: false };
  const certificate = await Certificate.create({
    code: await uniqueCode(),
    userId: user.id,
    cohortId: cohort.id,
    recipientName: user.name,
    programTitle: program.title,
    cohortName: cohort.name,
    attendancePercent: percent,
    completedOn: cohort.endsAt || new Date(),
    issuedAt: new Date(),
    issuedById,
    issueNote: note,
  });
  await Enrollment.update({ status: 'completed' }, { where: { cohortId: cohort.id, userId: user.id, status: 'active' } });
  return { certificate, created: true };
}

async function notifyCertificate(certificate) {
  try {
    const user = await User.findByPk(certificate.userId);
    if (!user) return;
    await mailer.sendNotice({
      user,
      subject: `Your certificate is ready: ${certificate.programTitle}`,
      heading: 'Congratulations, your certificate is ready',
      body: `${user.name.split(' ')[0]}, you completed ${certificate.programTitle} (${certificate.cohortName}). Your certificate carries the code ${certificate.code}. Anyone can check it is genuine on our verification page.`,
      buttonText: 'View your certificate',
      buttonUrl: `${appUrl()}/certificates/${certificate.code}`,
    });
  } catch (err) {
    console.error('[certificates] email failed:', err.message);
  }
}

// Issues to everyone who met the rule. Suspended and removed students are never included.
async function issueForCohort(cohortId, issuedById = null) {
  const cohort = await Cohort.findByPk(cohortId, { include: [Program] });
  const { held, students } = await cohortAttendance(cohortId);
  const result = { issued: 0, skipped: 0, already: 0 };
  for (const st of students) {
    if (!['active', 'completed'].includes(st.enrollment.status)) {
      result.skipped += 1;
      continue;
    }
    if (!isEligible(cohort, st.percent, held.length)) {
      result.skipped += 1;
      continue;
    }
    const { certificate, created } = await issue({ cohort, program: cohort.Program, user: st.user, percent: st.percent, issuedById });
    if (created) {
      result.issued += 1;
      await notifyCertificate(certificate);
    } else result.already += 1;
  }
  return result;
}

module.exports = { normalizeCode, isEligible, issue, issueForCohort, notifyCertificate };
