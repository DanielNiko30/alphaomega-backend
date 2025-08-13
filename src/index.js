const express = require('express');
const cors = require('cors');
const { getDB } = require('./config/sequelize');

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors({ origin: '*' }));

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
