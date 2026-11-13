module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Recording',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      cohortId: { type: DataTypes.UUID, allowNull: false },
      sessionId: { type: DataTypes.UUID },
      title: { type: DataTypes.STRING(160), allowNull: false },
      description: { type: DataTypes.TEXT },
      // Only the 11-character YouTube id is stored; the embed address is built from it
      youtubeId: { type: DataTypes.STRING(20), allowNull: false },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      // published | hidden
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'published' },
    },
    { tableName: 'Recordings', indexes: [{ fields: ['cohortId'] }, { fields: ['sessionId'] }] }
  );
