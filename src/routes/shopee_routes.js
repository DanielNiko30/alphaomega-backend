const express = require('express');
const router = express.Router();
const {
    shopeeCallback,
    getShopeeItemList,
    createProductShopee,
    getShopeeCategories,
    getShopeeLogistics,
    getBrandListShopee,
    updateProductShopee,
    getShopeeItemInfo,
    getShopeeOrders,
    setShopeePickup,
    setShopeeDropoff,
    getOrderDetail,
    searchShopeeProductByName,
    getShopeeOrdersWithItems,
    getShippingParameter,
    createShippingDocumentJob
} = require('../controller/shopee_controller');

// Shopee basic
router.get('/callback', shopeeCallback);
router.get('/products', getShopeeItemList);
router.post('/products/:id_product', createProductShopee);
router.get('/categories', getShopeeCategories);
router.get('/logistics', getShopeeLogistics);
router.get('/brand', getBrandListShopee);
router.put('/product/update/:id_product', updateProductShopee);
router.post('/product/item-info/:id_product', getShopeeItemInfo);

// Orders
router.get('/orders', getShopeeOrders);
router.get("/order-detail", getOrderDetail);
router.get('/orders/full', getShopeeOrdersWithItems);

// Search product
router.get('/searchproduct', searchShopeeProductByName);

// Shipping
router.post("/shipping-parameter", getShippingParameter);
router.post("/ship-order/pickup", setShopeePickup); 
router.post("/ship-order/dropoff", setShopeeDropoff); 
router.post('/orders/print-resi', createShippingDocumentJob);

module.exports = router;
