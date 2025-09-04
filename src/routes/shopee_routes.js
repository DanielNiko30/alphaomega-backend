const express = require('express');
const router = express.Router();
const { shopeeCallback, getShopeeItemList } = require('../controller/shopee_controller');

router.get('/callback', shopeeCallback);
router.get('/products', getShopeeItemList);

module.exports = router;
