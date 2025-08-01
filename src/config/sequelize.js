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
      logging: false,
      timezone: '+07:00',
      pool: {
        max: 5,          // kurangi biar ga overload di serverless
        min: 0,
        acquire: 10000,  // 10 detik timeout koneksi
        idle: 5000,
      },
      retry: {
        max: 3           // coba koneksi ulang 3x
      }
    });

    // Test koneksi segera saat inisialisasi (biar cepat error kalau gagal)
    dbInstance.authenticate()
      .then(() => console.log('DB connected successfully'))
      .catch(err => console.error('DB connection error:', err.message));
  }

  return dbInstance;
}

module.exports = { getDB };
