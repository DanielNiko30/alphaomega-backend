const { Sequelize } = require('sequelize');
require('dotenv').config();

let dbInstance;

function getDB() {
  if (!dbInstance) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is missing. Please set it in your environment variables.');
    }

    dbInstance = new Sequelize(process.env.DATABASE_URL, {
      dialect: 'postgres',
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
      },
      logging: false, // Matikan log query
      timezone: '+07:00',
      pool: {
        max: 10,
        min: 0,
        acquire: 30000,
        idle: 10000,
      },
    });
  }

  return dbInstance;
}

module.exports = { getDB };
