const express = require('express');
const router = express.Router();
const { shopeeCallback, getShopeeItemList, createProductShopee, getShopeeCategories, getShopeeLogistics, getBrandListShopee, updateProductShopee } = require('../controller/shopee_controller');

router.get('/callback', shopeeCallback);
router.get('/products', getShopeeItemList);
router.post('/products/:id_product', createProductShopee);
router.get('/categories', getShopeeCategories);
router.get('/logistics', getShopeeLogistics);
router.get('/brand', getBrandListShopee);
router.put('/product/update/:id_product', updateProductShopee);

module.exports = router;
