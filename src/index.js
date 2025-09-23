const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http'); // <-- tambahkan ini
const { getDB } = require('./config/sequelize');
const app = express();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors({ origin: '*' }));

require("./cron/refreshShopeeToken");

// Root route
app.get('/', (req, res) => {
  res.send('✅ Server Express berjalan dengan baik! Akses /api/health untuk cek database.');
});

// Route sementara untuk generate Shopee login URL
app.get('/api/shopee/generate-login-url', (req, res) => {
  try {
    const PARTNER_ID = Number(2012319);
    let PARTNER_KEY = 'shpk70754d646e53645a4450504e7a5a716871715a4c5877416647776555494f';
    if (PARTNER_KEY) PARTNER_KEY = PARTNER_KEY.trim();

    const timestamp = Math.floor(Date.now() / 1000);
    const path = '/api/v2/shop/auth_partner';

    const baseString = `${PARTNER_ID}${path}${timestamp}`;
    const sign = crypto.createHmac('sha256', PARTNER_KEY).update(baseString).digest('hex');

    const redirectUrl = encodeURIComponent('https://tokalphaomegaploso.my.id/api/shopee/callback');
    const state = 'xyz';

    const loginUrl = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}&redirect=${redirectUrl}&state=${state}`;

    res.json({ login_url: loginUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal generate login URL' });
  }
});

// Endpoint Lazada
app.post('/api/lazada/callback', (req, res) => {
  console.log('📦 Lazada Push Received:', req.body);

  if (req.body.type === 'VERIFY' && req.body.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  res.status(200).send('OK');
});

// Routes lain
app.use('/api/shopee', require('./routes/shopee_routes'));
app.use('/api/product', require('./routes/product_routes'));
app.use('/api/user', require('./routes/user_routes'));
app.use('/api/supplier', require('./routes/supplier_routes'));
app.use('/api/auth', require('./routes/auth_routes'));
app.use('/api/transaksiBeli', require('./routes/trans_beli_routes'));
app.use('/api/transaksiJual', require('./routes/trans_jual_routes'));

// -------------------- SOCKET.IO --------------------
const server = http.createServer(app);
const { Server } = require('socket.io');

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Buat global supaya bisa diakses di controller
global.io = io;

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("joinRoom", (userId) => {
    console.log(`User ${userId} joined room ${userId}`);
    socket.join(userId); // pegawai join room berdasarkan id_user_penjual
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});
// -----------------------------------------------------

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running at http://0.0.0.0:${PORT}`);
});
