const express = require('express');
const router = express.Router();
const { generateLoginUrl, lazadaCallback, refreshToken } = require('../controller/lazada_controller');

// === 1. Generate login URL ===
router.get('/generate-login-url', generateLoginUrl);

// === 2. Callback setelah user authorize ===
router.get('/callback', lazadaCallback);

// === 3. Refresh token manual ===
router.post('/refresh-token', refreshToken);

module.exports = router;
