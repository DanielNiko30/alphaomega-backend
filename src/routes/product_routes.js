const express = require('express');
const ProductController = require("../controller/product_controller");
const upload = require("../middleware/upload");
const router = express.Router();

router.get("/kategori", ProductController.getAllKategori);
router.put("/kategori/:id", ProductController.updateKategori);

router.get("/stok", ProductController.getAllStok);
router.get("/stok/:id", ProductController.getStokById);
router.put("/stok/:id", ProductController.updateStok);
router.delete("/stok/:id", ProductController.deleteStok);


router.get("/", ProductController.getAllProducts);
router.get('/with-stok', ProductController.getAllProductWithStok);
router.get("/search/:name", ProductController.getProductByName);
router.get("/latest/:productId?", ProductController.getLatestProduct);
router.get("/:id", ProductController.getProductById);
router.post("/", upload.single("gambar_product"), ProductController.createProduct);
router.put("/:id", upload.single("gambar_product"), ProductController.updateProduct);
router.delete("/:id", ProductController.deleteProduct);
router.get("/:id/satuan", ProductController.getSatuanByProductId);

router.post("/kategori", ProductController.addKategori);
router.post("/konversi-stok", ProductController.konversiStok);


module.exports = router;
