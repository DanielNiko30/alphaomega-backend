const express = require("express");
const router = express.Router();
const {
    getLaporanPenjualan,
    getLaporanPenjualanProduk,
    getLaporanPenjualanDetail,
    getLaporanPembelian,
    getLaporanPembelianProduk,
    getLaporanPembelianDetail,
} = require("../controller/laporan_controller");

router.get("/penjualan", getLaporanPenjualan);
router.get("/penjualan-produk", getLaporanPenjualanProduk);
router.get("/penjualan-detail", getLaporanPenjualanDetail);
router.get("/pembelian", getLaporanPembelian);
router.get("/pembelian-produk", getLaporanPembelianProduk);
router.get("/pembelian-detail", getLaporanPembelianDetail);

module.exports = router;
