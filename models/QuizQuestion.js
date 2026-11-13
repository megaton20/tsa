module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'QuizQuestion',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      programId: { type: DataTypes.UUID, allowNull: false },
      prompt: { type: DataTypes.TEXT, allowNull: false },
      options: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      correctIndex: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      points: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    { tableName: 'QuizQuestions', indexes: [{ fields: ['programId'] }] }
  );
