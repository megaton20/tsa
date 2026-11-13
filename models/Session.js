module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'ClassSession',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      cohortId: { type: DataTypes.UUID, allowNull: false },
      title: { type: DataTypes.STRING(160), allowNull: false },
      description: { type: DataTypes.TEXT },
      startsAt: { type: DataTypes.DATE, allowNull: false },
      endsAt: { type: DataTypes.DATE, allowNull: false },
      // Google Meet or Zoom link pasted by the team. Never shown to students on the page itself.
      meetLink: { type: DataTypes.TEXT },
      // The Join button works from this many minutes before the start until the end
      joinOpensMinutesBefore: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 15 },
      // scheduled | cancelled
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'scheduled' },
      leadId: { type: DataTypes.UUID },
      remindedDayAt: { type: DataTypes.DATE },
      remindedHourAt: { type: DataTypes.DATE },
    },
    { tableName: 'ClassSessions', indexes: [{ fields: ['cohortId', 'startsAt'] }, { fields: ['startsAt'] }] }
  );
