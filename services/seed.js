const { Role, User, SiteSetting } = require('../models');
const { DEFAULT_ROLES } = require('../utils/permissions');

// Creates missing default roles. Existing roles keep any edits made in the admin area,
// except superadmin which always holds every permission.
async function seedRoles() {
  for (const def of DEFAULT_ROLES) {
    const [role, created] = await Role.findOrCreate({ where: { slug: def.slug }, defaults: def });
    if (!created && def.slug === 'superadmin' && !(role.permissions || []).includes('*')) {
      role.permissions = ['*'];
      await role.save();
    }
  }
  await migratePhase2();
  await migratePhase3();
}

// One-time upgrade from Phase 1: set role scopes and add the permissions introduced in Phase 2.
async function migratePhase2() {
  if (await SiteSetting.findByPk('migration.phase2')) return;
  const added = ['programs.manage', 'programs.edit', 'payments.view'];
  for (const def of DEFAULT_ROLES) {
    const role = await Role.findOne({ where: { slug: def.slug } });
    if (!role || !role.isSystem) continue;
    role.scope = def.scope;
    if (def.slug !== 'superadmin') {
      role.permissions = [...new Set([...(role.permissions || []), ...def.permissions.filter((p) => added.includes(p))])];
    }
    await role.save();
  }
  await SiteSetting.create({ key: 'migration.phase2', value: new Date().toISOString() });
}

// One-time upgrade: built-in roles gain the permission to mark attendance by hand.
async function migratePhase3() {
  if (await SiteSetting.findByPk('migration.phase3')) return;
  for (const slug of ['admin', 'manager', 'instructor']) {
    const role = await Role.findOne({ where: { slug } });
    if (role && role.isSystem && !(role.permissions || []).includes('attendance.manage')) {
      role.permissions = [...(role.permissions || []), 'attendance.manage'];
      await role.save();
    }
  }
  await SiteSetting.create({ key: 'migration.phase3', value: new Date().toISOString() });
}

async function promoteSuperadmin() {
  const email = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) return;
  const [user, role] = await Promise.all([User.findOne({ where: { email } }), Role.findOne({ where: { slug: 'superadmin' } })]);
  if (user && role && user.roleId !== role.id) {
    user.roleId = role.id;
    await user.save();
    console.log(`[seed] ${email} promoted to superadmin`);
  }
}

async function defaultRoleId(email) {
  const wantSuper = email && email === (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  const role = await Role.findOne({ where: { slug: wantSuper ? 'superadmin' : 'student' } });
  return role ? role.id : null;
}

module.exports = { seedRoles, promoteSuperadmin, defaultRoleId };
