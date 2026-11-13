// Every permission the platform knows about. Later phases add more keys here.
const PERMISSION_GROUPS = [
  {
    label: 'Administration',
    items: {
      'dashboard.view': 'Open the admin area',
      'users.view': 'View users',
      'users.manage': 'Change user roles and suspend accounts',
      'users.impersonate': 'View the site as another user',
      'roles.manage': 'Create and edit roles',
      'settings.manage': 'Edit community links and site settings',
      'slides.manage': 'Manage homepage banners',
      'payments.view': 'View payments and revenue',
      'audit.view': 'View the audit log',
    },
  },
  {
    label: 'Programs and cohorts',
    items: {
      'programs.manage': 'Create and delete programs, appoint managers',
      'programs.edit': 'Edit the details of a program',
      'cohorts.manage': 'Create and run cohorts, edit the application quiz',
      'applications.review': 'Review applications and scholarship offers',
      'sessions.manage': 'Schedule sessions and paste meeting links',
      'attendance.view': 'View attendance',
      'attendance.manage': 'Mark attendance by hand',
      'students.manage': 'Manage and suspend students',
      'certificates.issue': 'Issue certificates',
      'staff.manage': 'Assign team members to a program',
    },
  },
];

const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => Object.keys(g.items));

// 'program' scope roles only take effect through a program assignment (see canProgram).
const DEFAULT_ROLES = [
  { slug: 'superadmin', name: 'Superadmin', description: 'Full access to everything', permissions: ['*'], isSystem: true, scope: 'global' },
  {
    slug: 'admin',
    name: 'Admin',
    description: 'Runs the platform day to day',
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'users.impersonate'),
    isSystem: true,
    scope: 'global',
  },
  {
    slug: 'manager',
    name: 'Program manager',
    description: 'Owns a program: team, applications, sessions and students',
    permissions: ['programs.edit', 'cohorts.manage', 'applications.review', 'sessions.manage', 'attendance.view', 'attendance.manage', 'students.manage', 'certificates.issue', 'staff.manage'],
    isSystem: true,
    scope: 'program',
  },
  {
    slug: 'instructor',
    name: 'Instructor',
    description: 'Runs sessions for assigned programs',
    permissions: ['sessions.manage', 'attendance.view', 'attendance.manage'],
    isSystem: true,
    scope: 'program',
  },
  {
    slug: 'moderator',
    name: 'Moderator',
    description: 'Admits students into live sessions using attendance',
    permissions: ['attendance.view'],
    isSystem: true,
    scope: 'program',
  },
  { slug: 'student', name: 'Student', description: 'Default role for every new account', permissions: [], isSystem: true, scope: 'global' },
];

// Global permission check. Program-scoped roles never grant anything globally.
function hasPermission(user, permission) {
  const role = user && user.Role;
  if (!role || role.scope === 'program') return false;
  const perms = role.permissions || [];
  return perms.includes('*') || perms.includes(permission);
}

// Permission inside one program: a global holder, or someone assigned to that program with a role that has it.
function canProgram(user, permission, programId) {
  if (hasPermission(user, permission)) return true;
  const list = (user && user.staffAssignments) || [];
  return list.some((a) => a.programId === programId && a.Role && (a.Role.permissions || []).includes(permission));
}

function canAccessAdmin(user) {
  return hasPermission(user, 'dashboard.view') || Boolean(user && user.staffAssignments && user.staffAssignments.length);
}

module.exports = { PERMISSION_GROUPS, ALL_PERMISSIONS, DEFAULT_ROLES, hasPermission, canProgram, canAccessAdmin };
