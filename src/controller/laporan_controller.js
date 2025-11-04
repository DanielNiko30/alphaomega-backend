const { Op, Sequelize } = require("sequelize");
const { HTransJual } = require("../model/htrans_jual_model");
const { DTransJual } = require("../model/dtrans_jual_model");
const { HTransBeli } = require("../model/htrans_beli_model");
const { DTransBeli } = require("../model/dtrans_beli_model");
const { Product } = require("../model/product_model");
const { Stok } = require('../model/stok_model');
const { Supplier } = require('../model/supplier_model');
const moment = require("moment");

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

            // 🔹 Ambil transaksi pembelian lengkap
            const transaksi = await HTransBeli.findAll({
                where: whereClause,
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
                    {
                        model: Supplier,
                        as: "supplier",
                        attributes: ["nama_supplier"],
                    },
                ],
                order: [["tanggal", "ASC"]],
            });

            let laporan = [];
            let grandTotalPembelian = 0;

            // 🔹 Loop semua transaksi
            for (const trx of transaksi) {
                let totalNota = 0;
                let detailBarang = [];

                // 🔹 Loop detail per transaksi
                for (const d of trx.detail_transaksi) {
                    const produk = d.produk;

                    // Cari stok buat tau harga beli per satuan (optional)
                    const stok = await Stok.findOne({
                        where: { id_product_stok: d.id_produk },
                        attributes: ["satuan", "harga", "harga_beli"],
                    });

                    const hargaBeli = d.harga_satuan || stok?.harga_beli || 0;
                    const jumlah = d.jumlah_barang;
                    const subtotal = hargaBeli * jumlah;

                    totalNota += subtotal;

                    detailBarang.push({
                        nama_product: produk?.nama_product || "Tidak Diketahui",
                        satuan: stok?.satuan || d.satuan,
                        jumlah,
                        harga_beli: hargaBeli,
                        subtotal,
                    });
                }

                grandTotalPembelian += totalNota;

                laporan.push({
                    id_htrans_beli: trx.id_htrans_beli,
                    tanggal: trx.tanggal,
                    pemasok: trx.supplier?.nama_supplier || "-",
                    metode_pembayaran: trx.metode_pembayaran,
                    nomor_invoice: trx.nomor_invoice,
                    detail: detailBarang,
                    total_nota: {
                        total_pembelian: totalNota,
                    },
                });
            }

            return res.json({
                success: true,
                periode: `${startDate} s.d ${endDate}`,
                data: laporan,
                grand_total: {
                    total_pembelian: grandTotalPembelian,
                },
            });
        } catch (err) {
            console.error("❌ Error getLaporanPembelian:", err);
            return res.status(500).json({
                success: false,
                message: "Gagal memuat laporan pembelian harian",
                error: err.message,
            });
        }
    },

    getLaporanPembelianHarian: async (req, res) => {
        try {
            const { tanggal } = req.query;

            if (!tanggal) {
                return res.status(400).json({
                    success: false,
                    message: "Parameter 'tanggal' wajib diisi (format: YYYY-MM-DD)",
                });
            }

            // 🔹 Langsung pakai tanggal, cocok untuk kolom DATE
            const transaksi = await HTransBeli.findAll({
                where: { tanggal },
                include: [
                    {
                        model: DTransBeli,
                        as: "detail_transaksi",
                        include: [
                            {
                                model: Product,
                                as: "produk",
                                include: [{ model: Stok, as: "stok" }],
                            },
                        ],
                    },
                    { model: Supplier, as: "supplier", attributes: ["nama_supplier"] },
                ],
                order: [["id_htrans_beli", "ASC"]],
            });

            if (!transaksi || transaksi.length === 0) {
                return res.json({
                    success: true,
                    message: `Tidak ada transaksi pembelian untuk tanggal: ${tanggal}`,
                    data: [],
                    total: { pembelian: 0 },
                });
            }

            let laporan = [];
            let totalPembelian = 0;

            transaksi.forEach((trx) => {
                trx.detail_transaksi.forEach((d) => {
                    const produk = d.produk;
                    const stok = produk?.stok?.[0];

                    const satuan = stok?.satuan || "-";
                    const hargaBeli = d.harga_satuan || stok?.harga_beli || 0;
                    const jumlah = d.jumlah_barang;
                    const subtotal = hargaBeli * jumlah;

                    totalPembelian += subtotal;

                    laporan.push({
                        waktu: trx.tanggal,
                        barang: produk?.nama_product || "Tidak Diketahui",
                        pemasok: trx.supplier?.nama_supplier || "-",
                        jumlah,
                        satuan,
                        harga_beli: hargaBeli,
                        subtotal,
                        pembayaran: trx.metode_pembayaran,
                        invoice: trx.nomor_invoice,
                    });
                });
            });

            return res.json({
                success: true,
                data: laporan,
                total: { pembelian: totalPembelian },
            });

        } catch (err) {
            console.error("❌ Error getLaporanPembelianHarian:", err);
            return res.status(500).json({
                success: false,
                message: "Gagal memuat laporan pembelian harian",
                error: err.message,
            });
        }
    }

};

module.exports = LaporanController;
