module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'RecordingView',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      recordingId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      firstViewedAt: { type: DataTypes.DATE, allowNull: false },
      lastViewedAt: { type: DataTypes.DATE, allowNull: false },
      viewCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    },
    { tableName: 'RecordingViews', indexes: [{ unique: true, fields: ['recordingId', 'userId'] }, { fields: ['userId'] }] }
  );
