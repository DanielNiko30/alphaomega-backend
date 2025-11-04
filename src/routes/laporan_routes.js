const express = require("express");
const router = express.Router();
const {
    getLaporanPenjualan,
    getLaporanPenjualanHarian,
    // getLaporanPembelian,
    // getLaporanPembelianHarian
} = require("../controller/laporan_controller");

router.get("/penjualan", getLaporanPenjualan);
router.get("/penjualan/harian", getLaporanPenjualanHarian);
// router.get("/pembelian", getLaporanPembelian);
// router.get("/pembelian/harian", getLaporanPembelianHarian);

module.exports = router;
