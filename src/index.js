const express = require('express');
const cors = require('cors');
const { getDB } = require('./config/sequelize');

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors({ origin: '*' }));

// Route root untuk cek server via browser
app.get('/', (req, res) => {
  res.send('✅ Server Express berjalan dengan baik! Akses /api/health untuk cek database.');
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

app.get('/callback', (req, res) => {
  // tangani authorization code atau deauthorization
  res.send('✅ Shopee callback berhasil diterima!');
});

app.post('/api/lazada/callback', (req, res) => {
  console.log('📦 Lazada Push Received:', req.body);

  // Jika ini request verifikasi dari Lazada
  if (req.body.type === 'VERIFY' && req.body.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  // Kalau bukan verifikasi, berarti ini data event (order, produk, dll)
  res.status(200).send('OK');
});


// Routes API
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

// app.listen(PORT, '127.0.0.1', () => {
//   console.log(`✅ Server running at http://127.0.0.1:${PORT}`);
// });