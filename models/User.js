module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'User',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      email: {
        type: DataTypes.STRING(190),
        allowNull: false,
        set(v) {
          this.setDataValue('email', String(v).trim().toLowerCase());
        },
      },
      passwordHash: { type: DataTypes.STRING },
      // How the account was originally created: 'local' or 'google'
      authProvider: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'local', validate: { isIn: [['local', 'google']] } },
      googleId: { type: DataTypes.STRING },
      avatarUrl: { type: DataTypes.TEXT },
      emailVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      verifyTokenHash: { type: DataTypes.STRING(64) },
      verifyExpires: { type: DataTypes.DATE },
      resetTokenHash: { type: DataTypes.STRING(64) },
      resetExpires: { type: DataTypes.DATE },
      timezone: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'Africa/Lagos' },
      timezoneConfirmed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active', validate: { isIn: [['active', 'suspended']] } },
      reminderEmails: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      whatsappPromptSeen: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      lastLoginAt: { type: DataTypes.DATE },
    },
    {
      tableName: 'Users',
      indexes: [
        { unique: true, fields: ['email'] },
        { unique: true, fields: ['googleId'] },
      ],
    }
  );
