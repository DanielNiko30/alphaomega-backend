const { Sequelize } = require('sequelize');
require('dotenv').config();

let dbInstance;

function getDB() {
  if (!dbInstance) {
    let sequelizeConfig;

    if (process.env.DATABASE_URL) {
      // Gunakan DATABASE_URL jika tersedia
      sequelizeConfig = new Sequelize(process.env.DATABASE_URL, {
        dialect: 'postgres',
        dialectOptions: {
          ssl: {
            require: true,
            rejectUnauthorized: false,
          },
        },
        logging: console.log, // tampilkan log ke console Replit
        timezone: '+07:00',
        pool: {
          max: 5,
          min: 0,
          acquire: 10000,
          idle: 5000,
        },
        retry: {
          max: 3,
        },
      });
    } else {
      // Fallback ke koneksi manual dari variabel .env
      sequelizeConfig = new Sequelize(
        process.env.DB_NAME,
        process.env.DB_USER,
        process.env.DB_PASSWORD,
        {
          host: process.env.DB_HOST || 'localhost',
          port: process.env.DB_PORT || 5432,
          dialect: 'postgres',
          dialectOptions: {
            ssl: process.env.DB_SSL === 'true' ? {
              require: true,
              rejectUnauthorized: false,
            } : false,
          },
          logging: console.log,
          timezone: '+07:00',
          pool: {
            max: 5,
            min: 0,
            acquire: 10000,
            idle: 5000,
          },
          retry: {
            max: 3,
          },
        }
      );
    }

    dbInstance = sequelizeConfig;

    // Tes koneksi langsung
    dbInstance.authenticate()
      .then(() => console.log('✅ DB connected successfully'))
      .catch(err => console.error('❌ DB connection error:', err.message));
  }

  return dbInstance;
}

module.exports = { getDB };
