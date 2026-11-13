module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Attendance',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      sessionId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      // join = pressed Join on the site, manual = marked by the team
      method: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'join' },
      firstJoinedAt: { type: DataTypes.DATE },
      lastJoinedAt: { type: DataTypes.DATE },
      joinCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      ip: { type: DataTypes.STRING(64) },
      userAgent: { type: DataTypes.STRING(255) },
      markedById: { type: DataTypes.UUID },
      note: { type: DataTypes.STRING(255) },
    },
    { tableName: 'Attendances', indexes: [{ unique: true, fields: ['sessionId', 'userId'] }, { fields: ['userId'] }] }
  );
