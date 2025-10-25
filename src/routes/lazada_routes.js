const express = require('express');
const router = express.Router();
const { 
    generateLoginUrl, 
    lazadaCallback, 
    refreshToken, 
    createProductLazada, 
    updateProductLazada,
    getCategoryTree,
    getBrands,
    getProducts,
    getCategoryAttributes,
    getAllCategoryAttributes,
    getProductItemLazada,
    getFullOrderDetailLazada,
    getLazadaOrders,
    getLazadaOrdersWithItems,
    getLazadaReadyOrdersWithItems,
    getSeller,
    getWarehouseBySeller
} = require('../controller/lazada_controller');

router.get('/generate-login-url', generateLoginUrl);
router.get('/callback', lazadaCallback);
router.post('/refresh-token', refreshToken);
router.post('/create-product/:id_product', createProductLazada);
// router.post('/create-product', createDummyProduct);
router.put('/update-product/:id_product', updateProductLazada);
router.get("/categories", getCategoryTree);
router.get("/category/attribute/:category_id", getCategoryAttributes);
router.get("/brands", getBrands);
router.get("/products", getProducts);
router.get("/category/attributes/:category_id?", getAllCategoryAttributes);
router.get("/product/item", getProductItemLazada);
router.get("/order/detail", getFullOrderDetailLazada);
router.get("/orders", getLazadaOrders);
router.get("/orders/full", getLazadaOrdersWithItems);
router.get("/ready/orders/full", getLazadaReadyOrdersWithItems);
router.get("/seller",getSeller);
router.get("/warehouse", getWarehouseBySeller);

module.exports = router;
