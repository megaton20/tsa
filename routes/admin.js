const express = require('express');
const { Op, fn } = require('sequelize');
const { User, Role, HeroSlide, AuditLog, Program, Cohort, Application, Enrollment, Payment, ProgramStaff } = require('../models');
const { requireAuth, requirePermission, requireAdminAccess } = require('../middleware/guards');
const { visibleTasks } = require('../services/tasks');
const { verifyCsrf } = require('../middleware/csrf');
const { imageUpload } = require('../middleware/upload');
const { PERMISSION_GROUPS, ALL_PERMISSIONS, hasPermission } = require('../utils/permissions');
const { audit } = require('../services/audit');
const { getSettings, saveSettings } = require('../services/settings');
const { fromLagosInput, toLagosInput, fmtDateTime, isSafeUrl, isHttps, isEmail, slugify } = require('../utils/format');

const router = express.Router();
router.use(requireAuth, requireAdminAccess);

const isSuper = (user) => hasPermission(user, '*');
const escLike = (s) => s.replace(/[\\%_]/g, '\\$&');

function paginate(req, perPage = 20) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  return { page, limit: perPage, offset: (page - 1) * perPage };
}

function backTo(req, fallback) {
  const b = req.body && req.body.back;
  return typeof b === 'string' && /^\/admin\/[A-Za-z0-9\/_?=&%.-]*$/.test(b) ? b : fallback;
}

// ---------- Overview ----------
router.get('/', async (req, res, next) => {
  try {
    const global = hasPermission(req.user, 'dashboard.view');
    let stats = null;
    if (global) {
      const studentRole = await Role.findOne({ where: { slug: 'student' } });
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const [totalUsers, newUsers, staffCount, activeSlides, activeStudents, revenue] = await Promise.all([
        User.count(),
        User.count({ where: { createdAt: { [Op.gte]: weekAgo } } }),
        ProgramStaff.count({ distinct: true, col: 'userId' }),
        HeroSlide.count({ where: { isActive: true } }),
        Enrollment.count({ where: { status: 'active' } }),
        hasPermission(req.user, 'payments.view') ? Payment.sum('amountKobo', { where: { status: 'success' } }) : null,
      ]);
      stats = { totalUsers, newUsers, staffCount, activeSlides, activeStudents, revenue: revenue === null ? null : revenue || 0 };
    }

    // Programs this person can see, with what is waiting for them
    const all = hasPermission(req.user, 'programs.manage');
    const ids = (req.user.staffAssignments || []).map((a) => a.programId);
    let programs = [];
    if (all || ids.length) {
      programs = await Program.findAll({ where: all ? {} : { id: ids }, include: [{ model: Cohort, required: false }], order: [['updatedAt', 'DESC']], limit: 12 });
    }
    const cohortIds = programs.flatMap((p) => p.Cohorts.map((c) => c.id));
    const review = cohortIds.length ? await Application.findAll({ attributes: ['cohortId', [fn('COUNT', '*'), 'n']], where: { cohortId: cohortIds, status: 'in_review' }, group: ['cohortId'], raw: true }) : [];
    const reviewBy = {};
    review.forEach((r) => (reviewBy[r.cohortId] = Number(r.n)));
    const rows = programs.map((p) => ({
      program: p,
      open: p.Cohorts.filter((c) => c.status === 'open').length,
      pending: p.Cohorts.reduce((n, c) => n + (reviewBy[c.id] || 0), 0),
    }));

    const recent = res.locals.can('audit.view')
      ? await AuditLog.findAll({ order: [['createdAt', 'DESC']], limit: 8, include: [{ model: User, as: 'actor', attributes: ['name'] }] })
      : [];
    const tasks = await visibleTasks(req.user, 5);
    res.render('admin/index', { title: 'Overview', active: 'overview', stats, rows, recent, tasks });
  } catch (err) {
    next(err);
  }
});

// ---------- Homepage banners ----------
const slideImages = imageUpload('slides');
const runUpload = slideImages.run;
const removeUploaded = slideImages.remove;

const CTA_TYPES = ['details', 'whatsapp', 'telegram', 'custom'];

async function parseSlide(req, existing) {
  const b = req.body;
  const errors = [];
  const data = {
    title: String(b.title || '').trim(),
    subtitle: String(b.subtitle || '').trim() || null,
    badge: String(b.badge || '').trim().slice(0, 60) || null,
    textOverlay: b.textOverlay === 'on',
    ctaType: CTA_TYPES.includes(b.ctaType) ? b.ctaType : 'custom',
    ctaLabel: String(b.ctaLabel || '').trim().slice(0, 60) || null,
    ctaUrl: String(b.ctaUrl || '').trim() || null,
    sortOrder: parseInt(b.sortOrder, 10) || 0,
    isActive: b.isActive === 'on',
    startsAt: fromLagosInput(b.startsAt),
    endsAt: fromLagosInput(b.endsAt),
    imageUrl: existing ? existing.imageUrl : null,
  };
  data.programId = /^[0-9a-f-]{36}$/i.test(String(b.programId || '')) ? b.programId : null;
  if (!data.title) errors.push('Add a title.');
  if (data.ctaUrl) {
    const needsHttps = data.ctaType === 'whatsapp' || data.ctaType === 'telegram';
    if (needsHttps ? !isHttps(data.ctaUrl) : !isSafeUrl(data.ctaUrl)) errors.push('The button link is not valid.');
    if (!data.ctaLabel) data.ctaLabel = data.ctaType === 'details' ? 'View details' : 'Join the community';
  }
  if (data.startsAt && data.endsAt && data.endsAt <= data.startsAt) errors.push('The end time must be after the start time.');
  if (req.file) data.imageUrl = slideImages.urlFor(req.file);
  else if (b.imageUrlText && isSafeUrl(String(b.imageUrlText).trim())) data.imageUrl = String(b.imageUrlText).trim();
  if (b.removeImage === 'on' && !req.file) data.imageUrl = null;
  // Linked to a program: the button goes to its page, and its banner is used when none is uploaded
  if (data.programId) {
    const program = await Program.findByPk(data.programId);
    if (!program) data.programId = null;
    else {
      if (data.ctaType === 'details') {
        data.ctaUrl = `/programs/${program.slug}`;
        if (!data.ctaLabel) data.ctaLabel = 'View program';
      }
      if (!data.imageUrl && program.bannerUrl) data.imageUrl = program.bannerUrl;
    }
  }
  return { data, errors };
}

router.get('/slides', requirePermission('slides.manage'), async (req, res, next) => {
  try {
    const slides = await HeroSlide.findAll({ order: [['sortOrder', 'ASC'], ['createdAt', 'DESC']] });
    res.render('admin/slides', { title: 'Homepage banners', active: 'slides', slides });
  } catch (err) {
    next(err);
  }
});

const publishedPrograms = () => Program.findAll({ where: { status: { [Op.in]: ['published', 'draft'] } }, attributes: ['id', 'title', 'status'], order: [['title', 'ASC']] });

router.get('/slides/new', requirePermission('slides.manage'), async (req, res, next) => {
  try {
    res.render('admin/slide-form', {
      title: 'New banner',
      active: 'slides',
      slide: { isActive: true, textOverlay: true, ctaType: 'details', sortOrder: 0 },
      errors: [],
      isNew: true,
      programs: await publishedPrograms(),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/slides', requirePermission('slides.manage'), runUpload, verifyCsrf, async (req, res, next) => {
  try {
    const { data, errors } = await parseSlide(req, null);
    if (errors.length) {
      if (req.file) removeUploaded(data.imageUrl);
      return res.status(400).render('admin/slide-form', { title: 'New banner', active: 'slides', slide: data, errors, isNew: true, programs: await publishedPrograms() });
    }
    const slide = await HeroSlide.create(data);
    await audit(req, 'slide.create', 'HeroSlide', slide.id, { title: slide.title });
    req.flash('success', 'Banner created.');
    return res.redirect('/admin/slides');
  } catch (err) {
    return next(err);
  }
});

router.get('/slides/:id/edit', requirePermission('slides.manage'), async (req, res, next) => {
  try {
    const slide = await HeroSlide.findByPk(req.params.id);
    if (!slide) return res.status(404).render('errors/404', { title: 'Not found' });
    return res.render('admin/slide-form', { title: 'Edit banner', active: 'slides', slide, errors: [], isNew: false, programs: await publishedPrograms() });
  } catch (err) {
    return next(err);
  }
});

router.post('/slides/:id', requirePermission('slides.manage'), runUpload, verifyCsrf, async (req, res, next) => {
  try {
    const slide = await HeroSlide.findByPk(req.params.id);
    if (!slide) return res.status(404).render('errors/404', { title: 'Not found' });
    const oldImage = slide.imageUrl;
    const { data, errors } = await parseSlide(req, slide);
    if (errors.length) {
      if (req.file) removeUploaded(data.imageUrl);
      return res.status(400).render('admin/slide-form', { title: 'Edit banner', active: 'slides', slide: { ...data, id: slide.id }, errors, isNew: false, programs: await publishedPrograms() });
    }
    await slide.update(data);
    if (oldImage && oldImage !== data.imageUrl) removeUploaded(oldImage);
    await audit(req, 'slide.update', 'HeroSlide', slide.id, { title: slide.title });
    req.flash('success', 'Banner saved.');
    return res.redirect('/admin/slides');
  } catch (err) {
    return next(err);
  }
});

router.post('/slides/:id/toggle', requirePermission('slides.manage'), async (req, res, next) => {
  try {
    const slide = await HeroSlide.findByPk(req.params.id);
    if (slide) {
      slide.isActive = !slide.isActive;
      await slide.save();
      await audit(req, slide.isActive ? 'slide.activate' : 'slide.deactivate', 'HeroSlide', slide.id, { title: slide.title });
    }
    res.redirect('/admin/slides');
  } catch (err) {
    next(err);
  }
});

router.post('/slides/:id/delete', requirePermission('slides.manage'), async (req, res, next) => {
  try {
    const slide = await HeroSlide.findByPk(req.params.id);
    if (slide) {
      removeUploaded(slide.imageUrl);
      await slide.destroy();
      await audit(req, 'slide.delete', 'HeroSlide', req.params.id, { title: slide.title });
      req.flash('success', 'Banner deleted.');
    }
    res.redirect('/admin/slides');
  } catch (err) {
    next(err);
  }
});

// ---------- Users ----------
router.get('/users', requirePermission('users.view'), async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const roleId = parseInt(req.query.role, 10) || null;
    const { page, limit, offset } = paginate(req, 20);
    const where = {};
    if (q) where[Op.or] = [{ name: { [Op.iLike]: `%${escLike(q)}%` } }, { email: { [Op.iLike]: `%${escLike(q)}%` } }];
    if (roleId) where.roleId = roleId;
    const [{ rows, count }, roles] = await Promise.all([
      User.findAndCountAll({ where, include: [Role], order: [['createdAt', 'DESC']], limit, offset, distinct: true }),
      Role.findAll({ order: [['name', 'ASC']] }),
    ]);
    const assignable = roles.filter((r) => r.scope === 'global');
    res.render('admin/users', {
      title: 'Users', active: 'users', users: rows, roles, assignable, q, roleId,
      page, pages: Math.max(Math.ceil(count / limit), 1), total: count,
      back: req.originalUrl,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/role', requirePermission('users.manage'), async (req, res, next) => {
  try {
    const back = backTo(req, '/admin/users');
    const [target, role] = await Promise.all([
      User.findByPk(req.params.id, { include: [Role] }),
      Role.findByPk(parseInt(req.body.roleId, 10) || 0),
    ]);
    const deny = (msg) => {
      req.flash('error', msg);
      return res.redirect(back);
    };
    if (!target || !role) return deny('That user or role no longer exists.');
    if (role.scope !== 'global') return deny('Program roles are assigned from the program\'s Team page.');
    if (target.id === req.actor.id) return deny('You cannot change your own role.');
    if (!isSuper(req.user) && (role.slug === 'superadmin' || isSuper(target))) return deny('Only a superadmin can change superadmin access.');
    if (!isSuper(req.user) && !(role.permissions || []).every((p) => hasPermission(req.user, p))) {
      return deny('You can only assign roles whose permissions you already have.');
    }
    const from = target.Role ? target.Role.slug : null;
    target.roleId = role.id;
    await target.save();
    await audit(req, 'user.role.change', 'User', target.id, { email: target.email, from, to: role.slug });
    req.flash('success', `${target.name} is now ${role.name}.`);
    return res.redirect(back);
  } catch (err) {
    return next(err);
  }
});

router.post('/users/:id/status', requirePermission('users.manage'), async (req, res, next) => {
  try {
    const back = backTo(req, '/admin/users');
    const target = await User.findByPk(req.params.id, { include: [Role] });
    if (!target) return res.redirect(back);
    if (target.id === req.actor.id) {
      req.flash('error', 'You cannot suspend your own account.');
      return res.redirect(back);
    }
    if (isSuper(target) && !isSuper(req.user)) {
      req.flash('error', 'Only a superadmin can suspend a superadmin.');
      return res.redirect(back);
    }
    target.status = target.status === 'active' ? 'suspended' : 'active';
    await target.save();
    await audit(req, target.status === 'suspended' ? 'user.suspend' : 'user.reactivate', 'User', target.id, { email: target.email });
    req.flash('success', target.status === 'suspended' ? `${target.name} is suspended.` : `${target.name} is active again.`);
    return res.redirect(back);
  } catch (err) {
    return next(err);
  }
});

router.post('/users/:id/impersonate', requirePermission('users.impersonate'), async (req, res, next) => {
  try {
    const target = await User.findByPk(req.params.id, { include: [Role] });
    if (!target || target.status !== 'active' || target.id === req.actor.id || isSuper(target)) {
      req.flash('error', 'You cannot view the site as that user.');
      return res.redirect(backTo(req, '/admin/users'));
    }
    req.session.impersonateId = target.id;
    await audit(req, 'user.impersonate.start', 'User', target.id, { email: target.email });
    return res.redirect(hasPermission(target, 'dashboard.view') ? '/admin' : '/dashboard');
  } catch (err) {
    return next(err);
  }
});

// ---------- Roles ----------
router.get('/roles', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const roles = await Role.findAll({ order: [['id', 'ASC']] });
    const counts = {};
    for (const r of roles) counts[r.id] = await User.count({ where: { roleId: r.id } });
    res.render('admin/roles', { title: 'Roles and permissions', active: 'roles', roles, counts, groups: PERMISSION_GROUPS, canGrant: (p) => hasPermission(req.user, p) });
  } catch (err) {
    next(err);
  }
});

function submittedPermissions(req) {
  return [].concat(req.body.permissions || []).filter((p) => ALL_PERMISSIONS.includes(p));
}

router.post('/roles', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 80);
    const slug = slugify(name);
    if (!name || !slug) {
      req.flash('error', 'Give the role a name.');
      return res.redirect('/admin/roles');
    }
    if (await Role.findOne({ where: { slug } })) {
      req.flash('error', 'A role with that name already exists.');
      return res.redirect('/admin/roles');
    }
    const permissions = submittedPermissions(req).filter((p) => hasPermission(req.user, p));
    const scope = req.body.scope === 'program' ? 'program' : 'global';
    const role = await Role.create({ slug, name, scope, description: String(req.body.description || '').trim().slice(0, 255), permissions });
    await audit(req, 'role.create', 'Role', role.id, { name, scope, permissions });
    req.flash('success', 'Role created.');
    return res.redirect('/admin/roles');
  } catch (err) {
    return next(err);
  }
});

router.post('/roles/:id', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role || role.slug === 'superadmin') {
      req.flash('error', 'That role cannot be edited.');
      return res.redirect('/admin/roles');
    }
    const existing = role.permissions || [];
    let next_ = submittedPermissions(req);
    if (!isSuper(req.user)) {
      // Keep permissions the editor does not hold, and only grant ones they do hold.
      next_ = [...next_.filter((p) => hasPermission(req.user, p)), ...existing.filter((p) => !hasPermission(req.user, p))];
    }
    const permissions = [...new Set(next_)];
    role.name = String(req.body.name || role.name).trim().slice(0, 80) || role.name;
    role.description = String(req.body.description || '').trim().slice(0, 255);
    role.permissions = permissions;
    await role.save();
    await audit(req, 'role.update', 'Role', role.id, { name: role.name, permissions });
    req.flash('success', `${role.name} saved.`);
    return res.redirect('/admin/roles');
  } catch (err) {
    return next(err);
  }
});

router.post('/roles/:id/delete', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role || role.isSystem) {
      req.flash('error', 'Built-in roles cannot be deleted.');
      return res.redirect('/admin/roles');
    }
    if (await User.count({ where: { roleId: role.id } })) {
      req.flash('error', 'Move the people in this role to another role first.');
      return res.redirect('/admin/roles');
    }
    await role.destroy();
    await audit(req, 'role.delete', 'Role', req.params.id, { name: role.name });
    req.flash('success', 'Role deleted.');
    return res.redirect('/admin/roles');
  } catch (err) {
    return next(err);
  }
});

// ---------- Settings ----------
router.get('/settings', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    res.render('admin/settings', { title: 'Settings', active: 'settings', values: await getSettings(), errors: [] });
  } catch (err) {
    next(err);
  }
});

router.post('/settings', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const values = {};
    const errors = [];
    for (const key of ['whatsappChannelUrl', 'whatsappGroupUrl', 'telegramUrl']) {
      const v = String(req.body[key] || '').trim();
      if (v && !isHttps(v)) errors.push('Community links must start with https://');
      values[key] = v;
    }
    const email = String(req.body.supportEmail || '').trim();
    if (email && !isEmail(email)) errors.push('Enter a valid support email.');
    values.supportEmail = email;
    if (errors.length) return res.status(400).render('admin/settings', { title: 'Settings', active: 'settings', values, errors: [...new Set(errors)] });
    await saveSettings(values);
    await audit(req, 'settings.update', 'SiteSetting', null, { keys: Object.keys(values) });
    req.flash('success', 'Settings saved.');
    return res.redirect('/admin/settings');
  } catch (err) {
    return next(err);
  }
});

// ---------- Audit log ----------
router.get('/audit', requirePermission('audit.view'), async (req, res, next) => {
  try {
    const action = String(req.query.action || '').trim();
    const { page, limit, offset } = paginate(req, 30);
    const where = action ? { action: { [Op.iLike]: `${escLike(action)}%` } } : {};
    const { rows, count } = await AuditLog.findAndCountAll({
      where, order: [['createdAt', 'DESC']], limit, offset,
      include: [{ model: User, as: 'actor', attributes: ['name', 'email'] }, { model: User, as: 'onBehalfOf', attributes: ['name'] }],
    });
    res.render('admin/audit', { title: 'Audit log', active: 'audit', logs: rows, action, page, pages: Math.max(Math.ceil(count / limit), 1) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
