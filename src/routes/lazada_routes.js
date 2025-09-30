const express = require('express');
const router = express.Router();
const { 
    generateLoginUrl, 
    lazadaCallback, 
    refreshToken, 
    createProductLazada, 
    updateProductLazada 
} = require('../controller/lazada_controller');

router.get('/generate-login-url', generateLoginUrl);
router.get('/callback', lazadaCallback);
router.post('/refresh-token', refreshToken);
router.post('/create-product/:id_product', createProductLazada);
router.put('/update-product/:id_product', updateProductLazada);

module.exports = router;
