module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Role',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      slug: { type: DataTypes.STRING(60), allowNull: false },
      name: { type: DataTypes.STRING(80), allowNull: false },
      description: { type: DataTypes.STRING(255) },
      permissions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      isSystem: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      // 'global' roles apply everywhere. 'program' roles only apply to programs the person is assigned to.
      scope: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'global' },
    },
    { tableName: 'Roles', indexes: [{ unique: true, fields: ['slug'] }] }
  );
