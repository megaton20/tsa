module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Enrollment',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      cohortId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      // active | suspended | completed | removed
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active' },
      // free | paid | scholarship | manual
      source: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'free' },
      applicationId: { type: DataTypes.UUID },
      paymentId: { type: DataTypes.UUID },
      enrolledAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      statusNote: { type: DataTypes.TEXT },
    },
    { tableName: 'Enrollments', indexes: [{ unique: true, fields: ['cohortId', 'userId'] }, { fields: ['userId'] }] }
  );
