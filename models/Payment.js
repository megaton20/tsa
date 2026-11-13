module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Payment',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      cohortId: { type: DataTypes.UUID, allowNull: false },
      applicationId: { type: DataTypes.UUID },
      reference: { type: DataTypes.STRING(64), allowNull: false },
      amountKobo: { type: DataTypes.INTEGER, allowNull: false },
      currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'NGN' },
      // pending | success | failed | abandoned
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending' },
      // enrollment | seat
      purpose: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'enrollment' },
      channel: { type: DataTypes.STRING(30) },
      gatewayId: { type: DataTypes.STRING(40) },
      paidAt: { type: DataTypes.DATE },
      note: { type: DataTypes.STRING(255) },
    },
    { tableName: 'Payments', indexes: [{ unique: true, fields: ['reference'] }, { fields: ['status'] }, { fields: ['userId'] }] }
  );
