const express = require('express');
const cors = require('cors');
const serverless = require('serverless-http');
const { getDB } = require('../src/config/sequelize');

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors({ origin: '*' }));

// Tes koneksi DB saat request pertama
app.use(async (req, res, next) => {
  try {
    const db = getDB();
    await db.authenticate();
    next();
  } catch (err) {
    console.error("DB connection failed:", err);
    return res.status(500).json({ error: "Database connection failed" });
  }
});

// Routes
app.use('/api/product', require('../src/routes/product_routes'));
app.use('/api/user', require('../src/routes/user_routes'));
app.use('/api/supplier', require('../src/routes/supplier_routes'));
app.use('/api/auth', require('../src/routes/auth_routes'));
app.use('/api/transaksiBeli', require('../src/routes/trans_beli_routes'));
app.use('/api/transaksiJual', require('../src/routes/trans_jual_routes'));

module.exports = serverless(app);
