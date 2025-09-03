const { Sequelize } = require('sequelize');
require('dotenv').config();

let dbInstance;

function getDB() {
  if (!dbInstance) {
    const dbName = process.env.DB_NAME;
    const dbUser = process.env.DB_USER;
    const dbPass = process.env.DB_PASS;
    const dbHost = process.env.DB_HOST || '127.0.0.1';
    const dbPort = process.env.DB_PORT || 3306;
    const dbDialect = process.env.DB_DIALECT || 'mysql';
    const dbSSL = process.env.DB_SSL === 'true';

    // Konfigurasi dasar Sequelize
    const sequelizeOptions = {
      host: dbHost,
      port: dbPort,
      dialect: dbDialect,
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
    };

    // Jika SSL aktif (untuk koneksi remote)
    if (dbSSL) {
      sequelizeOptions.dialectOptions = {
        ssl: {
          rejectUnauthorized: false,
        },
      };
    }

    // Paksa Sequelize selalu gunakan TCP, tidak fallback ke socket
    sequelizeOptions.dialectOptions = {
      ...sequelizeOptions.dialectOptions,
      connectTimeout: 60000,
    };

    // Buat instance Sequelize
    dbInstance = new Sequelize(dbName, dbUser, dbPass, sequelizeOptions);

    // Test koneksi
    (async () => {
      try {
        await dbInstance.authenticate();
        console.log(`✅ DB connected successfully: ${dbUser}@${dbHost}:${dbPort}/${dbName}`);
      } catch (err) {
        console.error(`❌ DB connection error for ${dbUser}@${dbHost}:`, err.message);
      }
    })();
  }

  return dbInstance;
}

module.exports = { getDB };
