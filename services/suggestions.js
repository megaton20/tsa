const { Op } = require('sequelize');
const { Program, Cohort, Enrollment, Application } = require('../models');
const { pickCohort } = require('../utils/cohort');

// Programs worth showing a student next: same category or tags as what they have taken, and open now.
async function suggestFor(user, limit = 3) {
  const [enrollments, applications] = await Promise.all([
    Enrollment.findAll({ where: { userId: user.id, status: { [Op.ne]: 'removed' } }, include: [{ model: Cohort, include: [Program] }] }),
    Application.findAll({ where: { userId: user.id }, include: [Cohort] }),
  ]);
  const taken = new Set(enrollments.map((e) => e.Cohort.programId));
  applications.filter((a) => !['declined', 'withdrawn'].includes(a.status)).forEach((a) => taken.add(a.Cohort.programId));
  const categories = new Set(enrollments.map((e) => e.Cohort.Program.category).filter(Boolean));
  const tags = new Set(enrollments.flatMap((e) => e.Cohort.Program.tags || []));

  const programs = await Program.findAll({
    where: { status: 'published', id: { [Op.notIn]: [...taken, '00000000-0000-0000-0000-000000000000'] } },
    include: [{ model: Cohort, required: false, where: { status: { [Op.ne]: 'draft' } } }],
  });
  return programs
    .map((p) => {
      const cohort = pickCohort(p.Cohorts || []);
      const open = cohort && cohort.status === 'open';
      let score = 0;
      if (p.category && categories.has(p.category)) score += 3;
      score += (p.tags || []).filter((t) => tags.has(t)).length;
      if (open) score += 2;
      if (open && cohort.scholarshipPercent > 0) score += 1;
      return { program: p, cohort, score, open };
    })
    .filter((s) => s.open)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

module.exports = { suggestFor };
