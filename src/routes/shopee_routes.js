const express = require('express');
const router = express.Router();
const { shopeeCallback, getShopeeItemList, createProductShopee } = require('../controller/shopee_controller');

router.get('/callback', shopeeCallback);
router.get('/products', getShopeeItemList);
router.post('/products/:id_product', createProductShopee);

module.exports = router;
