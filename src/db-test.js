const { Sequelize } = require('sequelize');
require('dotenv').config();

(async () => {
  const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      dialect: process.env.DB_DIALECT,
      dialectOptions: process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {},
      logging: console.log,
      pool: { max: 5, min: 0, acquire: 10000, idle: 5000 },
    }
  );

  try {
    await sequelize.authenticate();
    console.log('✅ DB connected successfully');
  } catch (err) {
    console.error('❌ DB connection error:', err.message);
    console.error('Full error:', err);
  } finally {
    await sequelize.close();
  }
})();
