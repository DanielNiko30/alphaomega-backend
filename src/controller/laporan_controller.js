const { Op, Sequelize } = require("sequelize");
const { HTransJual } = require("../models/htrans_jual_model");

const LaporanController = {
  getLaporanPenjualan: async (req, res) => {
    try {
      const { startDate, endDate, groupBy } = req.query;

      // 🔹 Default: ambil 1 bulan terakhir kalau tidak ada filter
      const today = new Date();
      const defaultStart = new Date();
      defaultStart.setMonth(today.getMonth() - 1);

      const start = startDate ? new Date(startDate) : defaultStart;
      const end = endDate ? new Date(endDate) : today;

      // 🔹 Tentukan grouping (harian, mingguan, bulanan)
      let dateFormat = "%Y-%m-%d"; // default harian
      if (groupBy === "month") dateFormat = "%Y-%m";
      if (groupBy === "week") dateFormat = "%x-%v"; // ISO week number

      const laporan = await HTransJual.findAll({
        attributes: [
          [Sequelize.fn("DATE_FORMAT", Sequelize.col("tanggal"), dateFormat), "periode"],
          [Sequelize.fn("COUNT", Sequelize.col("id_htrans_jual")), "jumlah_transaksi"],
          [Sequelize.fn("SUM", Sequelize.col("total_harga")), "total_penjualan"],
        ],
        where: {
          tanggal: {
            [Op.between]: [start, end],
          },
        },
        group: ["periode"],
        order: [[Sequelize.literal("periode"), "ASC"]],
      });

      return res.status(200).json({
        success: true,
        message: "Laporan penjualan berhasil diambil",
        data: laporan,
      });
    } catch (error) {
      console.error("Error laporan penjualan:", error);
      return res.status(500).json({
        success: false,
        message: "Gagal mengambil laporan penjualan",
        error: error.message,
      });
    }
  },
};

module.exports = LaporanController;
