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

            const platformList = ["offline", "shopee", "lazada"];
            let laporanPerPlatform = {};
            let grandTotal = {
                penjualan: 0,
                hpp: 0,
                untung: 0,
            };

            for (const platform of platformList) {
                const transaksi = await HTransJual.findAll({
                    where: {
                        tanggal: { [Op.between]: [startDate, endDate] },
                        sumber_transaksi: platform,
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

                let laporan = [];
                let totalPenjualan = 0;
                let totalHpp = 0;
                let totalUntung = 0;

                for (const trx of transaksi) {
                    let totalNota = {
                        penjualan: 0,
                        hpp: 0,
                        untung: 0,
                    };
                    let detailBarang = [];

                    for (const d of trx.detail_transaksi) {
                        const produk = d.produk;

                        const stok = await Stok.findOne({
                            where: { id_product_stok: d.id_produk, satuan: d.satuan },
                            attributes: ["satuan", "harga", "harga_beli"],
                        });

                        const hargaBeli = stok?.harga_beli || 0;
                        const hargaJual = d.harga_satuan;
                        const jumlah = d.jumlah_barang;

                        const subtotal = hargaJual * jumlah;
                        const hpp = hargaBeli * jumlah;
                        const untung = subtotal - hpp;

                        totalNota.penjualan += subtotal;
                        totalNota.hpp += hpp;
                        totalNota.untung += untung;

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

                    totalPenjualan += totalNota.penjualan;
                    totalHpp += totalNota.hpp;
                    totalUntung += totalNota.untung;

                    laporan.push({
                        id_htrans_jual: trx.id_htrans_jual,
                        tanggal: trx.tanggal,
                        metode_pembayaran: trx.metode_pembayaran,
                        detail: detailBarang,
                        total_nota: {
                            total_penjualan: totalNota.penjualan,
                            total_hpp: totalNota.hpp,
                            total_untung: totalNota.untung,
                        },
                    });
                }

                laporanPerPlatform[platform] = {
                    laporan,
                    total: {
                        penjualan: totalPenjualan,
                        hpp: totalHpp,
                        untung: totalUntung,
                    },
                };

                grandTotal.penjualan += totalPenjualan;
                grandTotal.hpp += totalHpp;
                grandTotal.untung += totalUntung;
            }

            return res.json({
                success: true,
                periode: `${startDate} s.d ${endDate}`,
                data: laporanPerPlatform,
                grand_total: grandTotal,
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

            const platformList = ["offline", "shopee", "lazada"];
            let laporanPerPlatform = {};

            for (const platform of platformList) {
                const transaksi = await HTransJual.findAll({
                    where: { tanggal, sumber_transaksi: platform },
                    include: [
                        {
                            model: DTransJual,
                            as: "detail_transaksi",
                            include: [
                                {
                                    model: Product,
                                    as: "produk",
                                    include: [{ model: Stok, as: "stok" }],
                                    attributes: ["nama_product"],
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

                transaksi.forEach(trx => {
                    trx.detail_transaksi.forEach(d => {
                        const produk = d.produk;
                        const stok = produk?.stok?.find(s => s.satuan === d.satuan);

                        const hargaBeli = stok?.harga_beli || 0;
                        const hargaJual = d.harga_satuan;
                        const jumlah = d.jumlah_barang;

                        const subtotal = hargaJual * jumlah;
                        const hpp = hargaBeli * jumlah;
                        const untung = subtotal - hpp;

                        totalPenjualan += subtotal;
                        totalHpp += hpp;
                        totalUntung += untung;

                        laporan.push({
                            waktu: trx.tanggal,
                            barang: produk?.nama_product || "Tidak Diketahui",
                            jumlah,
                            harga_jual: hargaJual,
                            pembayaran: trx.metode_pembayaran,
                            hpp: hargaBeli,
                            untung,
                        });
                    });
                });

                laporanPerPlatform[platform] = {
                    laporan,
                    total: {
                        penjualan: totalPenjualan,
                        hpp: totalHpp,
                        untung: totalUntung,
                    },
                };
            }

            return res.json({
                success: true,
                tanggal,
                data: laporanPerPlatform,
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

            const transaksi = await HTransBeli.findAll({
                where: { tanggal: { [Op.between]: [startDate, endDate] } }, // pakai string
                include: [
                    {
                        model: DTransBeli,
                        as: "detail_transaksi",
                        include: [
                            { model: Product, as: "produk", include: [{ model: Stok, as: "stok" }] }
                        ],
                    },
                    { model: Supplier, as: "supplier", attributes: ["nama_supplier"] },
                ],
                order: [["tanggal", "ASC"]],
            });

            let laporan = [];
            let grandTotal = 0;

            transaksi.forEach(trx => {
                trx.detail_transaksi.forEach(d => {
                    const produk = d.produk;
                    const stok = produk?.stok?.find(s => s.satuan === d.satuan) || produk?.stok?.[0];

                    const hargaBeli = d.harga_satuan || stok?.harga_beli || 0;
                    const jumlah = d.jumlah_barang;
                    const subtotal = hargaBeli * jumlah;

                    grandTotal += subtotal;

                    laporan.push({
                        waktu: trx.tanggal,
                        barang: produk?.nama_product || "Tidak Diketahui",
                        pemasok: trx.supplier?.nama_supplier || "-",
                        jumlah,
                        satuan: stok?.satuan || d.satuan,
                        harga_beli: hargaBeli,
                        subtotal,
                        pembayaran: trx.metode_pembayaran,
                        invoice: trx.nomor_invoice,
                    });
                });
            });

            return res.json({
                success: true,
                periode: `${startDate} s.d ${endDate}`,
                data: laporan,
                grand_total: { pembelian: grandTotal },
            });

        } catch (err) {
            console.error("❌ Error getLaporanPembelian:", err);
            return res.status(500).json({
                success: false,
                message: "Gagal memuat laporan pembelian",
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

            // Ambil transaksi langsung pakai tanggal string
            const transaksi = await HTransBeli.findAll({
                where: { tanggal }, // Op.eq secara default
                include: [
                    {
                        model: DTransBeli,
                        as: "detail_transaksi",
                        include: [
                            { model: Product, as: "produk", include: [{ model: Stok, as: "stok" }] }
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

            transaksi.forEach(trx => {
                trx.detail_transaksi.forEach(d => {
                    const produk = d.produk;
                    const stok = produk?.stok?.find(s => s.satuan === d.satuan) || produk?.stok?.[0];

                    const hargaBeli = d.harga_satuan || stok?.harga_beli || 0;
                    const jumlah = d.jumlah_barang;
                    const subtotal = hargaBeli * jumlah;

                    totalPembelian += subtotal;

                    laporan.push({
                        waktu: trx.tanggal,
                        barang: produk?.nama_product || "Tidak Diketahui",
                        pemasok: trx.supplier?.nama_supplier || "-",
                        jumlah,
                        satuan: stok?.satuan || d.satuan,
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
    },

    getLaporanStok: async (req, res) => {
        try {
            const { startDate, endDate } = req.query;
            if (!startDate || !endDate) {
                return res.status(400).json({
                    success: false,
                    message: "Parameter startDate dan endDate wajib diisi (format: YYYY-MM-DD)",
                });
            }

            const start = moment(startDate, "YYYY-MM-DD").startOf("day").toDate();
            const end = moment(endDate, "YYYY-MM-DD").endOf("day").toDate();

            const products = await Product.findAll({ include: [{ model: Stok, as: "stok" }] });

            let laporan = [];

            for (const p of products) {
                const idProduct = p.id_product;

                // 🔹 Stok awal = stok awal + pembelian sebelum periode - penjualan sebelum periode
                const stokMasukSebelum = await DTransBeli.sum("jumlah_barang", {
                    where: { id_produk: idProduct },
                    include: [{ model: HTransBeli, as: "HTransBeli", where: { tanggal: { [Op.lt]: start } }, attributes: [] }]
                }) || 0;

                const stokKeluarSebelum = await DTransJual.sum("jumlah_barang", {
                    where: { id_produk: idProduct },
                    include: [{ model: HTransJual, as: "HTransJual", where: { tanggal: { [Op.lt]: start } }, attributes: [] }]
                }) || 0;

                const stokAwal = (Number(p.stok?.[0]?.jumlah) || 0) + Number(stokMasukSebelum) - Number(stokKeluarSebelum);

                // 🔹 Stok masuk periode
                const pembelian = await DTransBeli.findAll({
                    include: [{ model: HTransBeli, as: "HTransBeli", where: { tanggal: { [Op.between]: [start, end] } }, attributes: ["tanggal", "nomor_invoice"] }],
                    where: { id_produk: idProduct },
                    order: [[{ model: HTransBeli, as: "HTransBeli" }, "tanggal", "ASC"]],
                });

                let totalMasuk = 0;
                const detailMasuk = pembelian.map(d => {
                    const jumlah = Number(d.jumlah_barang) || 0;
                    totalMasuk += jumlah;
                    return {
                        tanggal: d.HTransBeli.tanggal,
                        jumlah,
                        invoice: d.HTransBeli.nomor_invoice || "-"
                    };
                });

                // 🔹 Stok keluar periode
                const penjualan = await DTransJual.findAll({
                    include: [{ model: HTransJual, as: "HTransJual", where: { tanggal: { [Op.between]: [start, end] } }, attributes: ["tanggal"] }],
                    where: { id_produk: idProduct },
                    order: [[{ model: HTransJual, as: "HTransJual" }, "tanggal", "ASC"]],
                });

                let totalKeluar = 0;
                const detailKeluar = penjualan.map(d => {
                    const jumlah = Number(d.jumlah_barang) || 0;
                    totalKeluar += jumlah;
                    return {
                        tanggal: d.HTransJual.tanggal,
                        jumlah,
                    };
                });

                const stokAkhir = stokAwal + totalMasuk - totalKeluar;

                laporan.push({
                    nama_product: p.nama_product,
                    stok_awal: stokAwal,
                    total_masuk: totalMasuk,
                    detail_masuk: detailMasuk,
                    total_keluar: totalKeluar,
                    detail_keluar: detailKeluar,
                    stok_akhir: stokAkhir
                });
            }

            return res.json({
                success: true,
                periode: `${startDate} s.d ${endDate}`,
                data: laporan
            });

        } catch (err) {
            console.error("❌ Error getLaporanStok:", err);
            return res.status(500).json({
                success: false,
                message: "Gagal memuat laporan stok",
                error: err.message
            });
        }
    },

    getLaporanStokHarian: async (req, res) => {
        try {
            const { tanggal } = req.query;
            if (!tanggal) {
                return res.status(400).json({
                    success: false,
                    message: "Parameter 'tanggal' wajib diisi (format: YYYY-MM-DD)",
                });
            }

            const start = moment(tanggal, "YYYY-MM-DD").startOf("day").toDate();
            const end = moment(tanggal, "YYYY-MM-DD").endOf("day").toDate();

            const products = await Product.findAll({ include: [{ model: Stok, as: "stok" }] });

            let laporan = [];

            for (const p of products) {
                const idProduct = p.id_product;

                // Stok awal = stok terakhir sebelum hari ini
                const stokMasukSebelum = await DTransBeli.sum("jumlah_barang", {
                    where: { id_produk: idProduct },
                    include: [{ model: HTransBeli, as: "HTransBeli", where: { tanggal: { [Op.lt]: start } }, attributes: [] }]
                }) || 0;

                const stokKeluarSebelum = await DTransJual.sum("jumlah_barang", {
                    where: { id_produk: idProduct },
                    include: [{ model: HTransJual, as: "HTransJual", where: { tanggal: { [Op.lt]: start } }, attributes: [] }]
                }) || 0;

                const stokAwal = (Number(p.stok?.[0]?.jumlah) || 0) + Number(stokMasukSebelum) - Number(stokKeluarSebelum);

                // Stok masuk hari ini
                const pembelian = await DTransBeli.findAll({
                    include: [{ model: HTransBeli, as: "HTransBeli", where: { tanggal: { [Op.between]: [start, end] } }, attributes: ["tanggal", "nomor_invoice"] }],
                    where: { id_produk: idProduct },
                    order: [[{ model: HTransBeli, as: "HTransBeli" }, "tanggal", "ASC"]],
                });

                let totalMasuk = 0;
                const detailMasuk = pembelian.map(d => {
                    const jumlah = Number(d.jumlah_barang) || 0;
                    totalMasuk += jumlah;
                    return {
                        tanggal: d.HTransBeli.tanggal,
                        jumlah,
                        invoice: d.HTransBeli.nomor_invoice || "-"
                    };
                });

                // Stok keluar hari ini
                const penjualan = await DTransJual.findAll({
                    include: [{ model: HTransJual, as: "HTransJual", where: { tanggal: { [Op.between]: [start, end] } }, attributes: ["tanggal"] }],
                    where: { id_produk: idProduct },
                    order: [[{ model: HTransJual, as: "HTransJual" }, "tanggal", "ASC"]],
                });

                let totalKeluar = 0;
                const detailKeluar = penjualan.map(d => {
                    const jumlah = Number(d.jumlah_barang) || 0;
                    totalKeluar += jumlah;
                    return {
                        tanggal: d.HTransJual.tanggal,
                        jumlah,
                    };
                });

                const stokAkhir = stokAwal + totalMasuk - totalKeluar;

                laporan.push({
                    nama_product: p.nama_product,
                    stok_awal: stokAwal,
                    total_masuk: totalMasuk,
                    detail_masuk: detailMasuk,
                    total_keluar: totalKeluar,
                    detail_keluar: detailKeluar,
                    stok_akhir: stokAkhir
                });
            }

            return res.json({
                success: true,
                tanggal,
                data: laporan
            });

        } catch (err) {
            console.error("❌ Error getLaporanStokHarian:", err);
            return res.status(500).json({
                success: false,
                message: "Gagal memuat laporan stok harian",
                error: err.message
            });
        }
    },


};

module.exports = LaporanController;
