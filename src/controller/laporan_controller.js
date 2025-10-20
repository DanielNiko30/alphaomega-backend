const { Op, Sequelize } = require("sequelize");
const { HTransJual } = require("../model/htrans_jual_model");
const { DTransJual } = require("../model/dtrans_jual_model");
const { HTransBeli } = require("../model/htrans_beli_model");
const { DTransBeli } = require("../model/dtrans_beli_model");
const { Product } = require("../model/product_model");

const LaporanController = {
    // =====================================
    // ✅ LAPORAN PENJUALAN (SUDAH ADA)
    // =====================================
    getLaporanPenjualan: async (req, res) => {
        try {
            const { startDate, endDate, groupBy } = req.query;

            const today = new Date();
            const defaultStart = new Date();
            defaultStart.setMonth(today.getMonth() - 1);

            const start = startDate ? new Date(startDate) : defaultStart;
            const end = endDate ? new Date(endDate) : today;

            let dateFormat = "%Y-%m-%d";
            if (groupBy === "month") dateFormat = "%Y-%m";
            if (groupBy === "week") dateFormat = "%x-%v";

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

    // =====================================
    // ✅ LAPORAN PENJUALAN PER PRODUK
    // =====================================
    getLaporanPenjualanProduk: async (req, res) => {
        try {
            const { startDate, endDate } = req.query;

            const data = await DTransJual.findAll({
                include: [
                    {
                        model: HTransJual,
                        as: "HTransJual",
                        where: {
                            tanggal: {
                                [Op.between]: [startDate, endDate],
                            },
                        },
                        attributes: [],
                    },
                    {
                        model: Product,
                        as: "produk",
                        attributes: ["nama_product"],
                    },
                ],
                attributes: [
                    "id_produk",
                    [Sequelize.fn("SUM", Sequelize.col("jumlah_barang")), "total_terjual"],
                    [Sequelize.fn("SUM", Sequelize.col("subtotal")), "total_penjualan"],
                ],
                group: ["id_produk", "produk.nama_product"],
                raw: true,
            });

            const totalPendapatan = data.reduce((acc, item) => acc + parseFloat(item.total_penjualan || 0), 0);

            res.status(200).json({
                success: true,
                message: "Laporan penjualan per produk berhasil diambil",
                data,
                summary: {
                    total_produk: data.length,
                    total_pendapatan: totalPendapatan,
                },
            });
        } catch (error) {
            console.error("Error laporan penjualan per produk:", error);
            res.status(500).json({
                success: false,
                message: "Gagal mengambil laporan penjualan per produk",
                error: error.message,
            });
        }
    },

    // =====================================
    // ✅ LAPORAN PENJUALAN DETAIL
    // =====================================
    getLaporanPenjualanDetail: async (req, res) => {
        try {
            const { startDate, endDate } = req.query;

            const data = await HTransJual.findAll({
                where: {
                    tanggal: {
                        [Op.between]: [startDate, endDate],
                    },
                },
                include: [
                    {
                        model: DTransJual,
                        as: "detail_transaksi",
                        include: [
                            {
                                model: Product,
                                as: "produk",
                                attributes: ["nama_product"],
                            },
                        ],
                    },
                ],
                order: [["tanggal", "ASC"]],
            });

            const totalPendapatan = data.reduce((acc, h) => acc + parseFloat(h.total_harga || 0), 0);

            res.status(200).json({
                success: true,
                message: "Laporan penjualan detail berhasil diambil",
                data,
                summary: {
                    total_transaksi: data.length,
                    total_pendapatan: totalPendapatan,
                },
            });
        } catch (error) {
            console.error("Error laporan penjualan detail:", error);
            res.status(500).json({
                success: false,
                message: "Gagal mengambil laporan penjualan detail",
                error: error.message,
            });
        }
    },

    getLaporanPembelian: async (req, res) => {
        try {
            const { startDate, endDate, groupBy } = req.query;

            const today = new Date();
            const defaultStart = new Date();
            defaultStart.setMonth(today.getMonth() - 1);

            const start = startDate ? new Date(startDate) : defaultStart;
            const end = endDate ? new Date(endDate) : today;

            let dateFormat = "%Y-%m-%d";
            if (groupBy === "month") dateFormat = "%Y-%m";
            if (groupBy === "week") dateFormat = "%x-%v";

            const laporan = await HTransBeli.findAll({
                attributes: [
                    [Sequelize.fn("DATE_FORMAT", Sequelize.col("tanggal"), dateFormat), "periode"],
                    [Sequelize.fn("COUNT", Sequelize.col("id_htrans_beli")), "jumlah_transaksi"],
                    [Sequelize.fn("SUM", Sequelize.col("total_harga")), "total_pembelian"],
                ],
                where: {
                    tanggal: { [Op.between]: [start, end] },
                },
                group: ["periode"],
                order: [[Sequelize.literal("periode"), "ASC"]],
            });

            const totalPengeluaran = laporan.reduce(
                (acc, item) => acc + parseFloat(item.getDataValue("total_pembelian") || 0),
                0
            );

            return res.status(200).json({
                success: true,
                message: "Laporan pembelian berhasil diambil",
                data: laporan,
                summary: {
                    total_transaksi: laporan.length,
                    total_pengeluaran: totalPengeluaran,
                },
            });
        } catch (error) {
            console.error("Error laporan pembelian:", error);
            return res.status(500).json({
                success: false,
                message: "Gagal mengambil laporan pembelian",
                error: error.message,
            });
        }
    },

    // =====================================
    // 📦 LAPORAN PEMBELIAN PER PRODUK
    // =====================================
    getLaporanPembelianProduk: async (req, res) => {
        try {
            const { startDate, endDate, groupBy } = req.query;

            const today = new Date();
            const defaultStart = new Date();
            defaultStart.setMonth(today.getMonth() - 1);

            const start = startDate ? new Date(startDate) : defaultStart;
            const end = endDate ? new Date(endDate) : today;

            let dateFormat = "%Y-%m-%d";
            if (groupBy === "month") dateFormat = "%Y-%m";
            if (groupBy === "week") dateFormat = "%x-%v";

            const data = await DTransBeli.findAll({
                include: [
                    {
                        model: HTransBeli,
                        as: "HTransBeli",
                        where: { tanggal: { [Op.between]: [start, end] } },
                        attributes: [
                            [Sequelize.fn("DATE_FORMAT", Sequelize.col("HTransBeli.tanggal"), dateFormat), "periode"],
                        ],
                    },
                    {
                        model: Product,
                        as: "produk",
                        attributes: ["nama_product"],
                    },
                ],
                attributes: [
                    "id_produk",
                    [Sequelize.fn("SUM", Sequelize.col("jumlah_barang")), "total_terbeli"],
                    [Sequelize.fn("SUM", Sequelize.col("subtotal")), "total_pembelian"],
                ],
                group: [
                    "id_produk",
                    "produk.nama_product",
                    "HTransBeli.periode"
                ],
                raw: true,
            });

            const totalPengeluaran = data.reduce(
                (acc, item) => acc + parseFloat(item.total_pembelian || 0),
                0
            );

            res.status(200).json({
                success: true,
                message: "Laporan pembelian per produk berhasil diambil",
                data,
                summary: {
                    total_produk: data.length,
                    total_pengeluaran: totalPengeluaran,
                },
            });
        } catch (error) {
            console.error("Error laporan pembelian per produk:", error);
            res.status(500).json({
                success: false,
                message: "Gagal mengambil laporan pembelian per produk",
                error: error.message,
            });
        }
    },

    // =====================================
    // 🧾 LAPORAN PEMBELIAN DETAIL
    // =====================================
    getLaporanPembelianDetail: async (req, res) => {
        try {
            const { startDate, endDate } = req.query;

            const today = new Date();
            const defaultStart = new Date();
            defaultStart.setMonth(today.getMonth() - 1);

            const start = startDate ? new Date(startDate) : defaultStart;
            const end = endDate ? new Date(endDate) : today;

            const data = await HTransBeli.findAll({
                where: {
                    tanggal: { [Op.between]: [start, end] },
                },
                include: [
                    {
                        model: DTransBeli,
                        as: "detail_transaksi",
                        include: [
                            {
                                model: Product,
                                as: "produk",
                                attributes: ["nama_product"],
                            },
                        ],
                    },
                ],
                order: [["tanggal", "ASC"]],
            });

            const totalPengeluaran = data.reduce(
                (acc, h) => acc + parseFloat(h.total_harga || 0),
                0
            );

            res.status(200).json({
                success: true,
                message: "Laporan pembelian detail berhasil diambil",
                data,
                summary: {
                    total_transaksi: data.length,
                    total_pengeluaran: totalPengeluaran,
                },
            });
        } catch (error) {
            console.error("Error laporan pembelian detail:", error);
            res.status(500).json({
                success: false,
                message: "Gagal mengambil laporan pembelian detail",
                error: error.message,
            });
        }
    },
};

module.exports = LaporanController;
