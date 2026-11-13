const { AuditLog } = require('../models');

// Records who did what. Never throws: a logging problem must not break the action itself.
async function audit(req, action, entityType = null, entityId = null, meta = {}) {
  try {
    const actor = req.actor || req.user;
    await AuditLog.create({
      actorId: actor ? actor.id : null,
      onBehalfOfId: req.actor && req.user && req.actor.id !== req.user.id ? req.user.id : null,
      action,
      entityType,
      entityId: entityId ? String(entityId) : null,
      meta,
      ip: req.ip,
    });
  } catch (err) {
    console.error('[audit] failed:', err.message);
  }
}

module.exports = { audit };
