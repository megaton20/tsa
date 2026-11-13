module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'ProgramStaff',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      programId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      roleId: { type: DataTypes.INTEGER, allowNull: false },
    },
    { tableName: 'ProgramStaff', indexes: [{ unique: true, fields: ['programId', 'userId'] }, { fields: ['userId'] }] }
  );
