const express = require("express");
const router = express.Router();
const { getLaporanPenjualan } = require("../controllers/laporan_controller");

router.get("/penjualan", getLaporanPenjualan);

module.exports = router;
