const { Sequelize } = require('sequelize');
const path = require('path');

// Pilih file .env sesuai mode
const envFile =
  process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';

require('dotenv').config({ path: path.resolve(process.cwd(), envFile) });

let dbInstance;

function getDB() {
  if (!dbInstance) {
    if (process.env.NODE_ENV === 'production') {
      // Mode Supabase PostgreSQL
      if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is missing in production');
      }
      dbInstance = new Sequelize(process.env.DATABASE_URL, {
        dialect: 'postgres',
        dialectOptions: {
          ssl: {
            require: true,
            rejectUnauthorized: false,
          },
        },
        logging: false,
        timezone: '+07:00',
        pool: {
          max: 10,
          min: 0,
          acquire: 30000,
          idle: 10000,
        },
      });
    } else {
      // Mode lokal MySQL
      const { DB_NAME, DB_USER, DB_PASS, DB_HOST, DB_PORT } = process.env;

      if (!DB_NAME || !DB_USER || !DB_HOST) {
        throw new Error('MySQL config is missing in .env.development');
      }

      dbInstance = new Sequelize(DB_NAME, DB_USER, DB_PASS, {
        host: DB_HOST,
        port: DB_PORT || 3306,
        dialect: 'mysql',
        logging: true,
        timezone: '+07:00',
        pool: {
          max: 10,
          min: 0,
          acquire: 30000,
          idle: 10000,
        },
      });
    }
  }
  return dbInstance;
}

module.exports = { getDB };
