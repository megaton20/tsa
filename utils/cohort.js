// What a student pays after the scholarship is applied, in kobo.
function payableKobo(cohort) {
  const full = cohort.fullFeeKobo || 0;
  const pct = Math.min(Math.max(cohort.scholarshipPercent || 0, 0), 100);
  return Math.max(Math.round((full * (100 - pct)) / 100), 0);
}

module.exports = { payableKobo };

const { naira } = require('./format');

// Which cohort a program card should talk about: the soonest open one, otherwise the most recent.
function pickCohort(cohorts = []) {
  const visible = cohorts.filter((c) => c.status !== 'draft');
  const open = visible.filter((c) => c.status === 'open').sort((a, b) => new Date(a.startsAt || 8.64e15) - new Date(b.startsAt || 8.64e15));
  if (open.length) return open[0];
  return visible.sort((a, b) => new Date(b.startsAt || b.createdAt) - new Date(a.startsAt || a.createdAt))[0] || null;
}

// Short price text for cards
function priceLabel(cohort) {
  if (!cohort) return '';
  if (cohort.enrollmentMode === 'community') return 'Community';
  const due = payableKobo(cohort);
  if (cohort.enrollmentMode === 'application') {
    if (cohort.scholarshipPercent > 0) return `${cohort.scholarshipPercent}% scholarship`;
    return due ? naira(due) : 'Free';
  }
  return due ? naira(due) : 'Free';
}

module.exports.pickCohort = pickCohort;
module.exports.priceLabel = priceLabel;
