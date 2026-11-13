module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Application',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      cohortId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      // in_progress | in_review | offered | waitlisted | not_selected | accepted | declined | expired | withdrawn
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'in_progress' },
      details: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      submittedAt: { type: DataTypes.DATE },
      quizAnswers: { type: DataTypes.JSONB },
      scorePercent: { type: DataTypes.INTEGER },
      quizSubmittedAt: { type: DataTypes.DATE },
      // grace | no_quiz  (why a manager has to look at it)
      reviewReason: { type: DataTypes.STRING(20) },
      // auto | grace | manual | waitlist
      offerType: { type: DataTypes.STRING(20) },
      offeredAt: { type: DataTypes.DATE },
      offerExpiresAt: { type: DataTypes.DATE },
      acceptedAt: { type: DataTypes.DATE },
      decisionNote: { type: DataTypes.TEXT },
      decidedById: { type: DataTypes.UUID },
    },
    { tableName: 'Applications', indexes: [{ unique: true, fields: ['cohortId', 'userId'] }, { fields: ['status'] }] }
  );
