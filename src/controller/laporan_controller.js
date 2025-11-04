const { Op, Sequelize } = require("sequelize");
const { HTransJual } = require("../model/htrans_jual_model");
const { DTransJual } = require("../model/dtrans_jual_model");
const { HTransBeli } = require("../model/htrans_beli_model");
const { DTransBeli } = require("../model/dtrans_beli_model");
const { Product } = require("../model/product_model");
const { Stok } = require('../model/stok_model');

const LaporanController = {
    getLaporanPenjualan: async (req, res) => {
        try {
            const { startDate, endDate, groupBy } = req.query;

            // Default filter tanggal: semua
            const whereClause = {};
            if (startDate && endDate) {
                whereClause.tanggal = {
                    [Op.between]: [startDate, endDate],
                };
            }

            // ambil data dasar
            const transaksi = await HTransJual.findAll({
                where: whereClause,
                include: [
                    {
                        model: DTransJual,
                        as: "detail_transaksi", // ✅ tambahkan alias
                        include: [
                            {
                                model: Stok,
                                as: "stok", // kalau di model stok juga pakai alias
                                include: [
                                    {
                                        model: Product,
                                        attributes: ["nama_product"],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });

            // mapping ke array yang sudah diolah
            const data = transaksi.map((t) => {
                const totalPenjualan = t.DTransJuals.reduce(
                    (sum, d) => sum + d.qty * d.Stok.harga_jual,
                    0
                );
                const totalHPP = t.DTransJuals.reduce(
                    (sum, d) => sum + d.qty * d.Stok.harga_beli,
                    0
                );

                return {
                    id_htrans_jual: t.id_htrans_jual,
                    tanggal: t.tanggal,
                    total_penjualan: totalPenjualan,
                    total_hpp: totalHPP,
                    total_untung: totalPenjualan - totalHPP,
                };
            });

            // --------------- 🔹 Grouping Sesuai Permintaan ---------------
            let groupedData = [];

            if (groupBy === "hari") {
                const mapHari = {};
                data.forEach((d) => {
                    const key = new Date(d.tanggal).toISOString().split("T")[0];
                    if (!mapHari[key]) {
                        mapHari[key] = { tanggal: key, total_penjualan: 0, total_hpp: 0, total_untung: 0 };
                    }
                    mapHari[key].total_penjualan += d.total_penjualan;
                    mapHari[key].total_hpp += d.total_hpp;
                    mapHari[key].total_untung += d.total_untung;
                });
                groupedData = Object.values(mapHari);
            }

            else if (groupBy === "bulan") {
                const mapBulan = {};
                data.forEach((d) => {
                    const date = new Date(d.tanggal);
                    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
                    if (!mapBulan[key]) {
                        mapBulan[key] = { bulan: key, total_penjualan: 0, total_hpp: 0, total_untung: 0 };
                    }
                    mapBulan[key].total_penjualan += d.total_penjualan;
                    mapBulan[key].total_hpp += d.total_hpp;
                    mapBulan[key].total_untung += d.total_untung;
                });
                groupedData = Object.values(mapBulan);
            }

            else if (groupBy === "produk") {
                const mapProduk = {};
                transaksi.forEach((t) => {
                    t.DTransJuals.forEach((d) => {
                        const nama = d.Stok.Product.nama_product;
                        if (!mapProduk[nama]) {
                            mapProduk[nama] = {
                                nama_product: nama,
                                qty: 0,
                                total_penjualan: 0,
                                total_hpp: 0,
                                total_untung: 0,
                            };
                        }
                        mapProduk[nama].qty += d.qty;
                        mapProduk[nama].total_penjualan += d.qty * d.Stok.harga_jual;
                        mapProduk[nama].total_hpp += d.qty * d.Stok.harga_beli;
                        mapProduk[nama].total_untung += d.qty * (d.Stok.harga_jual - d.Stok.harga_beli);
                    });
                });
                groupedData = Object.values(mapProduk);
            }

            else {
                // default per transaksi
                groupedData = data;
            }

            res.status(200).json({
                success: true,
                message: "Laporan penjualan berhasil diambil",
                data: groupedData,
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({
                success: false,
                message: "Gagal mengambil laporan penjualan",
                error: err.message,
            });
        }
    },

    getLaporanPenjualanHarian: async (req, res) => {
        try {
            const { tanggal } = req.query;

            if (!tanggal) {
                return res.status(400).json({
                    success: false,
                    message: "Parameter 'tanggal' wajib diisi (format: YYYY-MM-DD)",
                });
            }

            // Ambil transaksi jual harian + relasi produk dan stok
            const transaksi = await HTransJual.findAll({
                where: { tanggal },
                include: [
                    {
                        model: DTransJual,
                        as: "detail_transaksi",
                        include: [
                            {
                                model: Product,
                                as: "produk",
                                include: [
                                    {
                                        model: Stok,
                                        as: "stok",
                                    },
                                ],
                            },
                        ],
                    },
                ],
                order: [["id_htrans_jual", "ASC"]],
            });

            let laporan = [];
            let totalPenjualan = 0;
            let totalHpp = 0;
            let totalUntung = 0;

            transaksi.forEach((trx) => {
                trx.detail_transaksi.forEach((d) => {
                    const produk = d.produk;
                    const stok = produk?.stok?.find((s) => s.satuan === d.satuan);

                    const hargaBeli = stok ? stok.harga_beli : 0;
                    const hargaJual = d.harga_satuan;
                    const hpp = hargaBeli * d.jumlah_barang;
                    const subtotal = hargaJual * d.jumlah_barang;
                    const untung = subtotal - hpp;

                    totalPenjualan += subtotal;
                    totalHpp += hpp;
                    totalUntung += untung;

                    laporan.push({
                        waktu: trx.tanggal,
                        barang: produk?.nama_product || "Tidak Diketahui",
                        jumlah: d.jumlah_barang,
                        harga_jual: hargaJual,
                        pembayaran: trx.metode_pembayaran,
                        hpp: hargaBeli,
                        untung: untung,
                    });
                });
            });

            return res.json({
                success: true,
                data: laporan,
                total: {
                    penjualan: totalPenjualan,
                    hpp: totalHpp,
                    untung: totalUntung,
                },
            });
        } catch (err) {
            console.error("❌ Error getLaporanPenjualanHarian:", err);
            return res.status(500).json({
                success: false,
                message: "Gagal memuat laporan penjualan harian",
                error: err.message,
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
                group: [Sequelize.fn("DATE_FORMAT", Sequelize.col("tanggal"), dateFormat)],
                order: [[Sequelize.literal("periode"), "ASC"]],
                raw: true,
            });

            const totalPengeluaran = laporan.reduce(
                (acc, item) => acc + parseFloat(item.total_pembelian || 0),
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
                    [Sequelize.fn("DATE_FORMAT", Sequelize.col("HTransBeli.tanggal"), dateFormat), "periode"],
                    [Sequelize.fn("SUM", Sequelize.col("jumlah_barang")), "total_terbeli"],
                    [Sequelize.fn("SUM", Sequelize.col("subtotal")), "total_pembelian"],
                ],
                group: [
                    "id_produk",
                    "produk.nama_product",
                    Sequelize.fn("DATE_FORMAT", Sequelize.col("HTransBeli.tanggal"), dateFormat),
                ],
                order: [[Sequelize.literal("periode"), "ASC"]],
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
