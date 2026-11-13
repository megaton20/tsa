module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'HeroSlide',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      title: { type: DataTypes.STRING(140), allowNull: false },
      subtitle: { type: DataTypes.TEXT },
      badge: { type: DataTypes.STRING(60) },
      imageUrl: { type: DataTypes.TEXT },
      // true: title/subtitle are drawn over the banner. false: banner is shown clean (text already in the image)
      textOverlay: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      // 'details' | 'whatsapp' | 'telegram' | 'custom'
      ctaType: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'custom' },
      ctaLabel: { type: DataTypes.STRING(60) },
      ctaUrl: { type: DataTypes.TEXT },
      programId: { type: DataTypes.UUID },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      startsAt: { type: DataTypes.DATE },
      endsAt: { type: DataTypes.DATE },
    },
    { tableName: 'HeroSlides' }
  );
