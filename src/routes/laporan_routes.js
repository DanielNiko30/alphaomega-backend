const express = require("express");
const router = express.Router();
const {
    getLaporanPenjualan,
    getLaporanPenjualanHarian,
    getLaporanPembelian,
    getLaporanPembelianProduk,
    getLaporanPembelianDetail,
} = require("../controller/laporan_controller");

router.get("/penjualan", getLaporanPenjualan);
router.get("/harian", getLaporanPenjualanHarian);
router.get("/pembelian", getLaporanPembelian);
router.get("/pembelian-produk", getLaporanPembelianProduk);
router.get("/pembelian-detail", getLaporanPembelianDetail);

module.exports = router;
