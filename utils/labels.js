const t = (text, tone) => ({ text, tone });
const GREEN = 'bg-emerald-50 text-emerald-700';
const AMBER = 'bg-amber-50 text-amber-700';
const ROSE = 'bg-rose-50 text-rose-700';
const SLATE = 'bg-slate-100 text-slate-600';
const SKY = 'bg-sky-50 text-sky-700';
const BRAND = 'bg-brand-soft text-brand-dark';

module.exports = {
  program: { draft: t('Draft', SLATE), published: t('Published', GREEN), suspended: t('Suspended', ROSE), archived: t('Archived', SLATE) },
  cohort: { draft: t('Draft', SLATE), open: t('Open', GREEN), closed: t('Closed', AMBER), completed: t('Completed', SLATE), suspended: t('Suspended', ROSE) },
  application: {
    in_progress: t('In progress', SLATE), in_review: t('In review', AMBER), offered: t('Offer made', GREEN), waitlisted: t('Waitlisted', SKY),
    not_selected: t('Not selected', ROSE), accepted: t('Accepted', GREEN), declined: t('Declined', SLATE), expired: t('Offer expired', ROSE), withdrawn: t('Withdrawn', SLATE),
  },
  enrollment: { active: t('Active', GREEN), suspended: t('Suspended', ROSE), completed: t('Completed', BRAND), removed: t('Removed', SLATE) },
  payment: { pending: t('Pending', AMBER), success: t('Paid', GREEN), failed: t('Failed', ROSE), abandoned: t('Abandoned', SLATE) },
  mode: { free: 'Free enrollment', pay: 'Paid enrollment', application: 'By application', community: 'Community' },
  staffRole: { manager: 'Program manager', instructor: 'Instructor', moderator: 'Moderator' },
};
