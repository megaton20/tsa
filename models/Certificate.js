module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Certificate',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      code: { type: DataTypes.STRING(20), allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      cohortId: { type: DataTypes.UUID, allowNull: false },
      // Details are copied at issue time so the certificate never changes if a program or a name is edited later
      recipientName: { type: DataTypes.STRING(160), allowNull: false },
      programTitle: { type: DataTypes.STRING(160), allowNull: false },
      cohortName: { type: DataTypes.STRING(120), allowNull: false },
      attendancePercent: { type: DataTypes.INTEGER },
      completedOn: { type: DataTypes.DATE, allowNull: false },
      issuedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      issuedById: { type: DataTypes.UUID },
      issueNote: { type: DataTypes.STRING(255) },
      revokedAt: { type: DataTypes.DATE },
      revokedReason: { type: DataTypes.STRING(255) },
    },
    { tableName: 'Certificates', indexes: [{ unique: true, fields: ['code'] }, { unique: true, fields: ['cohortId', 'userId'] }, { fields: ['userId'] }] }
  );
