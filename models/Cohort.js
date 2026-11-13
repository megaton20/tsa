module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Cohort',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      programId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(120), allowNull: false },
      // draft | open | closed | completed | suspended
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'draft', validate: { isIn: [['draft', 'open', 'closed', 'completed', 'suspended']] } },
      // free | pay | application | community
      enrollmentMode: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'application', validate: { isIn: [['free', 'pay', 'application', 'community']] } },
      fullFeeKobo: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      scholarshipPercent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      seats: { type: DataTypes.INTEGER },
      startsAt: { type: DataTypes.DATE },
      endsAt: { type: DataTypes.DATE },
      applicationDeadline: { type: DataTypes.DATE },
      offerWindowHours: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 72 },
      passMark: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 70 },
      graceMark: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60 },
      attendanceRequiredPercent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 75 },
      // Issue certificates to everyone who met the attendance rule when the cohort is marked completed
      autoIssueCertificates: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      sponsorName: { type: DataTypes.STRING(120) },
      whatsappUrl: { type: DataTypes.TEXT },
      telegramUrl: { type: DataTypes.TEXT },
    },
    { tableName: 'Cohorts', indexes: [{ fields: ['programId'] }, { fields: ['status'] }] }
  );
