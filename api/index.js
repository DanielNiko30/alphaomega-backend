const express = require('express');
const cors = require('cors');
const serverless = require('serverless-http');
const { getDB } = require('../src/config/sequelize');

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors({ origin: '*' }));

// Root route
app.get('/', (req, res) => {
  res.json({ message: 'API root is working' });
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const db = getDB();
    await db.authenticate();
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
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


// Jika ingin jalan lokal manual, uncomment:
// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//   console.log(`Local server running at http://localhost:${PORT}`);
// });
