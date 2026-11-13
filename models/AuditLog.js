module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'AuditLog',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      actorId: { type: DataTypes.UUID },
      // Set when the actor was "viewing as" another user
      onBehalfOfId: { type: DataTypes.UUID },
      action: { type: DataTypes.STRING(80), allowNull: false },
      entityType: { type: DataTypes.STRING(60) },
      entityId: { type: DataTypes.STRING(64) },
      meta: { type: DataTypes.JSONB, defaultValue: {} },
      ip: { type: DataTypes.STRING(64) },
    },
    { tableName: 'AuditLogs', indexes: [{ fields: ['createdAt'] }, { fields: ['action'] }] }
  );
