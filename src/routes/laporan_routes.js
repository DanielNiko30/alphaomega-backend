const express = require("express");
const router = express.Router();
const { getLaporanPenjualan, getLaporanPenjualanProduk, getLaporanPenjualanDetail } = require("../controller/laporan_controller");

router.get("/penjualan", getLaporanPenjualan);
router.get("/penjualan-produk", getLaporanPenjualanProduk);
router.get("/penjualan-detail", getLaporanPenjualanDetail);

module.exports = router;
