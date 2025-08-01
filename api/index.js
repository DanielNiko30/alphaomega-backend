const express = require('express');
const cors = require('cors');
const serverless = require('serverless-http');
const { getDB } = require('../src/config/sequelize');

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors({ origin: '*' }));

// ======= Cek koneksi DB sekali saat startup =======
const db = getDB();
db.authenticate()
  .then(() => console.log('DB connected successfully'))
  .catch(err => console.error('DB connection failed on startup:', err));

// ======= Route Health Check =======
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', db: !!db ? 'connected' : 'not connected' });
});

// ======= Routes utama =======
app.use('/api/product', require('../src/routes/product_routes'));
app.use('/api/user', require('../src/routes/user_routes'));
app.use('/api/supplier', require('../src/routes/supplier_routes'));
app.use('/api/auth', require('../src/routes/auth_routes'));
app.use('/api/transaksiBeli', require('../src/routes/trans_beli_routes'));
app.use('/api/transaksiJual', require('../src/routes/trans_jual_routes'));

// Export untuk serverless
module.exports = serverless(app);

// Jika ingin jalan lokal manual, uncomment:
// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//   console.log(`Local server running at http://localhost:${PORT}`);
// });
