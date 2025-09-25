const express = require('express');
const router = express.Router();
const { shopeeCallback,
    getShopeeItemList,
    createProductShopee,
    getShopeeCategories,
    getShopeeLogistics,
    getBrandListShopee,
    updateProductShopee,
    getShopeeItemInfo,
    getShopeeOrders,
    setShopeePickup,
    getOrderDetail,
    searchShopeeProductByName,
    getShopeeOrdersWithItems,
    getShippingParameter,
    createShippingDocumentJob } = require('../controller/shopee_controller');

router.get('/callback', shopeeCallback);
router.get('/products', getShopeeItemList);
router.post('/products/:id_product', createProductShopee);
router.get('/categories', getShopeeCategories);
router.get('/logistics', getShopeeLogistics);
router.get('/brand', getBrandListShopee);
router.put('/product/update/:id_product', updateProductShopee);
router.post('/product/item-info/:id_product', getShopeeItemInfo);
router.get('/orders', getShopeeOrders);
router.get("/order-detail", getOrderDetail);
router.get('/orders/full', getShopeeOrdersWithItems);
router.get('/searchproduct', searchShopeeProductByName);
router.post("/shipping-parameter", getShippingParameter);
router.post("/ship-order", setShopeePickup);
router.post('/orders/print-resi', createShippingDocumentJob);

module.exports = router;
