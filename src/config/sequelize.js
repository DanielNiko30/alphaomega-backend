require('dotenv').config();
const { Sequelize } = require("sequelize");

let db;

function getDB() {
  if (!db) {
    db = new Sequelize(
      process.env.DB_NAME,
      process.env.DB_USER,
      process.env.DB_PASS,
      {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        dialect: "mysql",
        dialectModule: require('mysql2'),
        logging: false,
        timezone: "+07:00",
      }
    );
  }
  return db;
}

module.exports = { getDB };