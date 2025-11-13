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
    getShopeeShippedOrders,
    getShopeeShippedOrdersWithItems,
    getShopeeTrackingInfo,
    getShippingDocumentInfo,
    getShippingDocumentResultController,
    createShopeeShippingDocument,
    downloadShippingDocumentController,
    printShopeeResi,
    updateStockShopee,
    getShopeeAttributeTree
} = require('../controller/shopee_controller');
const authMiddleware = require('../middleware/auth');

// Shopee basic
router.get('/callback', shopeeCallback);
router.get('/products', getShopeeItemList);
router.post('/products/:id_product', createProductShopee);
router.get('/categories', getShopeeCategories);
router.get('/logistics', getShopeeLogistics);
router.get('/brand', getBrandListShopee);
router.put('/product/update/:id_product', updateProductShopee);
router.post('/product/item-info/:id_product', getShopeeItemInfo);
router.get("/attribute-tree/:category_id", getShopeeAttributeTree);

// Orders
router.get('/orders', getShopeeOrders);
router.get('/orders/shipped', getShopeeShippedOrders);
router.get("/order-detail", getOrderDetail);
router.get('/orders/full', getShopeeOrdersWithItems);
router.get('/orders/shipped/full', getShopeeShippedOrdersWithItems);

// Search product
router.get('/searchproduct', searchShopeeProductByName);

// Shipping
router.post("/shipping-parameter", getShippingParameter);
router.post("/ship-order/pickup", authMiddleware, setShopeePickup);
router.post("/ship-order/dropoff", authMiddleware, setShopeeDropoff);
router.get("/tracking-info", getShopeeTrackingInfo);
router.post("/shipping-info", getShippingDocumentInfo);
router.post("/create-document", createShopeeShippingDocument);
router.post("/shipping-document/status", getShippingDocumentResultController);
router.post("/download-resi", downloadShippingDocumentController);
router.post("/print-resi", printShopeeResi);

//update stok
router.post("/update-stock", updateStockShopee);

module.exports = router;
