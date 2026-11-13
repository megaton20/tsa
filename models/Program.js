module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Program',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      title: { type: DataTypes.STRING(160), allowNull: false },
      slug: { type: DataTypes.STRING(180), allowNull: false },
      summary: { type: DataTypes.STRING(300) },
      description: { type: DataTypes.TEXT },
      category: { type: DataTypes.STRING(80) },
      tags: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      bannerUrl: { type: DataTypes.TEXT },
      // draft | published | suspended | archived
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'draft', validate: { isIn: [['draft', 'published', 'suspended', 'archived']] } },
    },
    { tableName: 'Programs', indexes: [{ unique: true, fields: ['slug'] }] }
  );
