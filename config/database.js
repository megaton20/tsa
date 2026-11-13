const { Sequelize } = require('sequelize');

const useSsl = process.env.DB_SSL === 'true';

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: useSsl ? { ssl: { require: true, rejectUnauthorized: false } } : {},
});

module.exports = sequelize;
