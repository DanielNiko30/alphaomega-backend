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
    createDummyProduct
} = require('../controller/lazada_controller');

router.get('/generate-login-url', generateLoginUrl);
router.get('/callback', lazadaCallback);
router.post('/refresh-token', refreshToken);
router.post('/create-product/:id_product', createProductLazada);
router.post('/create-product', createDummyProduct);
router.put('/update-product/:id_product', updateProductLazada);
router.get("/categories", getCategoryTree);
router.get("/brands", getBrands);
router.get("/products", getProducts);

module.exports = router;
