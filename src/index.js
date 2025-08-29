const express = require('express');
const cors = require('cors');
const { getDB } = require('./config/sequelize');

const app = express();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors({ origin: '*' }));

// Root route
app.get('/', (req, res) => {
  res.send('✅ Server Express berjalan dengan baik! Akses /api/health untuk cek database.');
});

app.post('/api/lazada/callback', (req, res) => {
  console.log('📦 Lazada Push Received:', req.body);

  if (req.body.type === 'VERIFY' && req.body.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  res.status(200).send('OK');
});

app.use('/api/shopee', require('./routes/shopee_routes'));
app.use('/api/product', require('./routes/product_routes'));
app.use('/api/user', require('./routes/user_routes'));
app.use('/api/supplier', require('./routes/supplier_routes'));
app.use('/api/auth', require('./routes/auth_routes'));
app.use('/api/transaksiBeli', require('./routes/trans_beli_routes'));
app.use('/api/transaksiJual', require('./routes/trans_jual_routes'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running at http://0.0.0.0:${PORT}`);
});
