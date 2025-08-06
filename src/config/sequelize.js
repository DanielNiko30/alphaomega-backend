const { Sequelize } = require('sequelize');
require('dotenv').config();

let dbInstance;

function getDB() {
  if (!dbInstance) {
    const dbName = process.env.DB_NAME;
    const dbUser = process.env.DB_USER;
    const dbPass = process.env.DB_PASS;
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = process.env.DB_PORT || 3306;
    const dbDialect = process.env.DB_DIALECT || 'mysql';

    dbInstance = new Sequelize(dbName, dbUser, dbPass, {
      host: dbHost,
      port: dbPort,
      dialect: dbDialect,
      dialectOptions: {
        ssl: {
          rejectUnauthorized: false, // 🛡️ Hindari error self-signed
        },
      },
      logging: console.log,          // Tampilkan query di console (debug)
      timezone: '+07:00',           // Waktu lokal Indonesia
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

    // Test koneksi saat inisialisasi
    dbInstance.authenticate()
      .then(() => console.log('✅ DB connected successfully'))
      .catch(err => console.error('❌ DB connection error:', err.message));
  }

  return dbInstance;
}

module.exports = { getDB };
