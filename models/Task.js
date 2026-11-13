// Chores the system notices by itself (a session without a Meet link, applications waiting for review).
// The same key is never duplicated, and a task closes itself when its condition stops being true.
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Task',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      key: { type: DataTypes.STRING(120), allowNull: false },
      programId: { type: DataTypes.UUID, allowNull: false },
      cohortId: { type: DataTypes.UUID },
      title: { type: DataTypes.STRING(255), allowNull: false },
      detail: { type: DataTypes.STRING(500) },
      href: { type: DataTypes.STRING(255) },
      // Who it is for: program staff holding this permission
      permission: { type: DataTypes.STRING(60), allowNull: false },
      dueAt: { type: DataTypes.DATE, allowNull: false },
      // open | done
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'open' },
      nudgedAt: { type: DataTypes.DATE },
      escalatedAt: { type: DataTypes.DATE },
      ownerEscalatedAt: { type: DataTypes.DATE },
      resolvedAt: { type: DataTypes.DATE },
    },
    { tableName: 'Tasks', indexes: [{ unique: true, fields: ['key'] }, { fields: ['status'] }, { fields: ['programId'] }] }
  );
