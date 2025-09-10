const express = require('express');
const router = express.Router();
const { shopeeCallback, getShopeeItemList, createProductShopee, getShopeeCategories, getShopeeLogistics } = require('../controller/shopee_controller');

router.get('/callback', shopeeCallback);
router.get('/products', getShopeeItemList);
router.post('/products/:id_product', createProductShopee);
router.get('/categories', getShopeeCategories);
router.get('/logistics', getShopeeLogistics);

module.exports = router;
