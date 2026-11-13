module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'SiteSetting',
    {
      key: { type: DataTypes.STRING(60), primaryKey: true },
      value: { type: DataTypes.TEXT },
    },
    { tableName: 'SiteSettings' }
  );
