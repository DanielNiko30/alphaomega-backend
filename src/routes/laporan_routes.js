const express = require("express");
const router = express.Router();
const { getLaporanPenjualan } = require("../controller/laporan_controller");

router.get("/penjualan", getLaporanPenjualan);

module.exports = router;
