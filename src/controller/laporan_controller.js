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
            const { startDate, endDate } = req.query;

            if (!startDate || !endDate) {
                return res.status(400).json({
                    success: false,
                    message: "Parameter startDate dan endDate wajib diisi (format: YYYY-MM-DD)",
                });
            }

            const whereClause = {
                tanggal: {
                    [Op.between]: [startDate, endDate],
                },
            };

            // 🔹 Ambil transaksi + detail + produk
            const transaksi = await HTransJual.findAll({
                where: whereClause,
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

            let laporan = [];
            let grandTotalPenjualan = 0;
            let grandTotalHPP = 0;
            let grandTotalUntung = 0;

            // 🔹 Loop semua transaksi
            for (const trx of transaksi) {
                let totalPenjualanNota = 0;
                let totalHppNota = 0;
                let totalUntungNota = 0;
                let detailBarang = [];

                // 🔹 Loop setiap detail transaksi
                for (const d of trx.detail_transaksi) {
                    const produk = d.produk;

                    // Cari stok berdasarkan id_produk + satuan
                    const stok = await Stok.findOne({
                        where: {
                            id_product_stok: d.id_produk,
                            satuan: d.satuan,
                        },
                        attributes: ["satuan", "harga", "harga_beli"],
                    });

                    const hargaBeli = stok ? stok.harga_beli : 0;
                    const hargaJual = d.harga_satuan;
                    const jumlah = d.jumlah_barang;

                    const subtotal = hargaJual * jumlah;
                    const hpp = hargaBeli * jumlah;
                    const untung = subtotal - hpp;

                    totalPenjualanNota += subtotal;
                    totalHppNota += hpp;
                    totalUntungNota += untung;

                    detailBarang.push({
                        nama_product: produk?.nama_product || "Tidak Diketahui",
                        satuan: stok?.satuan || d.satuan,
                        jumlah,
                        harga_jual: hargaJual,
                        harga_beli: hargaBeli,
                        subtotal,
                        hpp,
                        untung,
                    });
                }

                grandTotalPenjualan += totalPenjualanNota;
                grandTotalHPP += totalHppNota;
                grandTotalUntung += totalUntungNota;

                laporan.push({
                    id_htrans_jual: trx.id_htrans_jual,
                    tanggal: trx.tanggal,
                    metode_pembayaran: trx.metode_pembayaran,
                    detail: detailBarang,
                    total_nota: {
                        total_penjualan: totalPenjualanNota,
                        total_hpp: totalHppNota,
                        total_untung: totalUntungNota,
                    },
                });
            }

            return res.json({
                success: true,
                periode: `${startDate} s.d ${endDate}`,
                data: laporan,
                grand_total: {
                    total_penjualan: grandTotalPenjualan,
                    total_hpp: grandTotalHPP,
                    total_untung: grandTotalUntung,
                },
            });
        } catch (err) {
            console.error("❌ Error getLaporanPenjualan:", err);
            return res.status(500).json({
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
