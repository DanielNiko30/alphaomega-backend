const express = require("express");
const router = express.Router();
const {
    getLaporanPenjualan,
    getLaporanPenjualanHarian,
    getLaporanPembelian,
    getLaporanPembelianHarian,
    getLaporanStok,
    getLaporanStokHarian
} = require("../controller/laporan_controller");

router.get("/penjualan", getLaporanPenjualan);
router.get("/penjualan/harian", getLaporanPenjualanHarian);
router.get("/pembelian", getLaporanPembelian);
router.get("/pembelian/harian", getLaporanPembelianHarian);
router.get("/stok", getLaporanStok);
router.get("/stok/harian", getLaporanStokHarian);

module.exports = router;
