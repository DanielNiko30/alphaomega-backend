const express = require('express');
const router = express.Router();
const { shopeeCallback } = require('../controller/shopee_controller');

// 🔹 Endpoint callback Shopee
router.get('/callback', shopeeCallback);

module.exports = router;
