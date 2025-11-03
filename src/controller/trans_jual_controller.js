const { HTransJual } = require("../model/htrans_jual_model");
const { DTransJual } = require("../model/dtrans_jual_model");
const { Stok } = require("../model/stok_model");
const { User } = require('../model/user_model');
const { Op } = require("sequelize");
const axios = require("axios");
const NOTIF_URL = "https://tokalphaomegaploso.my.id/api/notifikasi/send";

async function generateHTransJualId() {
    const last = await HTransJual.findOne({ order: [["id_htrans_jual", "DESC"]] });
    let newId = "HTJ000001";
    if (last) {
        const num = parseInt(last.id_htrans_jual.replace("HTJ", ""), 10);
        newId = `HTJ${String(num + 1).padStart(6, "0")}`;
    }
    return newId;
}

async function generateDTransJualId() {
    const last = await DTransJual.findOne({ order: [["id_dtrans_jual", "DESC"]] });
    let newId = "DTJ000001";
    if (last) {
        const num = parseInt(last.id_dtrans_jual.replace("DTJ", ""), 10);
        newId = `DTJ${String(num + 1).padStart(6, "0")}`;
    }
    return newId;
}

async function generateInvoiceNumber() {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
    const prefix = `INV/${dateStr}/`;

    const lastInvoice = await HTransJual.findOne({
        where: {
            nomor_invoice: {
                [Op.like]: `${prefix}%`
            }
        },
        order: [["nomor_invoice", "DESC"]],
    });

    let nextNumber = 1;

    if (lastInvoice) {
        const match = lastInvoice.nomor_invoice.match(/INV\/\d{8}\/(\d+)/);
        if (match) {
            nextNumber = parseInt(match[1], 10) + 1;
        }
    }

    const newInvoice = `${prefix}${nextNumber.toString().padStart(6, "0")}`;
    return newInvoice;
}

const TransJualController = {
    getAllTransactions: async (req, res) => {
        try {
            const transactions = await HTransJual.findAll({ include: "detail_transaksi" });
            res.json(transactions);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    getTransactionById: async (req, res) => {
        try {
            const { id } = req.params;
            const transaction = await HTransJual.findByPk(id, {
                include: "detail_transaksi",
            });
            if (!transaction) return res.status(404).json({ message: "Not found" });
            res.json(transaction);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    getLatestInvoiceNumber: async (req, res) => {
        try {
            const invoice = await generateInvoiceNumber();
            res.json({ nomor_invoice: invoice });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    createTransaction: async (req, res) => {
        try {
            const { id_user, id_user_penjual, nama_pembeli, tanggal, total_harga, metode_pembayaran, detail } = req.body;

            // 1️⃣ Cek stok sebelum transaksi
            let stokTidakCukup = [];
            for (const item of detail) {
                const stock = await Stok.findOne({
                    where: {
                        id_product_stok: item.id_produk,
                        satuan: item.satuan,
                    }
                });

                const jumlahKurangi = Math.ceil(Number(item.jumlah_barang));
                if (!stock || stock.stok < jumlahKurangi) {
                    stokTidakCukup.push({
                        id_produk: item.id_produk,
                        satuan: item.satuan,
                        stok_tersedia: stock ? stock.stok : 0,
                        jumlah_diminta: jumlahKurangi,
                    });
                }
            }

            if (stokTidakCukup.length > 0) {
                return res.status(400).json({
                    message: "Transaksi dibatalkan. Beberapa produk memiliki stok tidak mencukupi.",
                    stok_tidak_cukup: stokTidakCukup
                });
            }

            // 2️⃣ Buat id_htrans_jual dan nomor invoice
            const id_htrans_jual = await generateHTransJualId();
            const nomor_invoice = await generateInvoiceNumber();

            // 3️⃣ Simpan HTransJual
            const newTransaction = await HTransJual.create({
                id_htrans_jual,
                id_user,
                id_user_penjual,
                nama_pembeli,
                tanggal,
                total_harga: Math.floor(Number(total_harga)),
                metode_pembayaran,
                nomor_invoice,
                status: "Pending",
                sumber_transaksi: "Offline"
            });

            // 4️⃣ Loop detail untuk buat DTransJual & update stok
            for (const item of detail) {
                const id_dtrans_jual = await generateDTransJualId();
                const jumlahKurangi = Math.ceil(Number(item.jumlah_barang));

                await DTransJual.create({
                    id_dtrans_jual,
                    id_htrans_jual,
                    id_produk: item.id_produk,
                    satuan: item.satuan,
                    jumlah_barang: Number(item.jumlah_barang),
                    harga_satuan: Number(item.harga_satuan),
                    subtotal: Math.floor(Number(item.subtotal)),
                });

                // 🔻 Update stok lokal
                const stock = await Stok.findOne({
                    where: {
                        id_product_stok: item.id_produk,
                        satuan: item.satuan,
                    }
                });

                const stokBaru = stock.stok - jumlahKurangi;
                await stock.update({ stok: stokBaru });

                // 🔁 Update ke Shopee & Lazada (async, tidak ganggu flow)
                (async () => {
                    try {
                        // 🟠 Shopee
                        if (stock.id_product_shopee) {
                            await axios.post("https://tokalphaomegaploso.my.id/api/shopee/update-stock", {
                                item_id: stock.id_product_shopee,
                                stock: stokBaru
                            });
                        }

                        // 🔵 Lazada
                        if (stock.id_product_lazada && stock.sku_lazada) {
                            await axios.post("https://tokalphaomegaploso.my.id/api/lazada/update-stock", {
                                item_id: String(stock.id_product_lazada),
                                sku_id: String(stock.sku_lazada),
                                quantity: stokBaru
                            });
                        }
                    } catch (err) {
                        console.error("❌ Gagal update stok marketplace:", {
                            produk: item.id_produk,
                            error: err.response?.data || err.message
                        });
                    }
                })();
            }

            // 5️⃣ Emit notifikasi realtime
            if (global.io && id_user_penjual) {
                global.io.to(String(id_user_penjual)).emit("newTransaction", {
                    id_htrans_jual,
                    nama_pembeli,
                    total_harga,
                    detail,
                    message: `Ada transaksi baru untuk ${nama_pembeli}`
                });
            }

            // 6️⃣ Response sukses
            const response = res.status(201).json({
                message: "Transaksi jual berhasil dibuat",
                invoice: nomor_invoice,
                id_htrans_jual,
            });

            // 🔔 Notifikasi eksternal (async)
            axios.post(NOTIF_URL, {
                title: "Pesanan Baru",
                message: `Ada pesanan baru dari ${nama_pembeli}. Mohon segera dikonfirmasi!`
            }).catch(err => {
                console.error("Gagal kirim notifikasi eksternal:", err.message);
            });

            return response;

        } catch (error) {
            console.error(error);
            res.status(500).json({ message: error.message });
        }
    },

    updateTransaction: async (req, res) => {
        const t = await HTransJual.sequelize.transaction();
        try {
            const { id_htrans_jual } = req.params;
            const {
                id_user,
                id_user_penjual,
                nama_pembeli,
                tanggal,
                total_harga,
                metode_pembayaran,
                detail
            } = req.body;

            console.log("🟡 Update Transaction ID:", id_htrans_jual);

            // 1️⃣ Ambil detail lama
            const oldDetails = await DTransJual.findAll({
                where: { id_htrans_jual },
                transaction: t
            });

            // 2️⃣ Map detail lama untuk perbandingan
            const oldDetailMap = {};
            oldDetails.forEach(item => {
                const key = `${item.id_produk}_${item.satuan}`;
                oldDetailMap[key] = item;
            });

            // 3️⃣ Update header transaksi
            await HTransJual.update(
                {
                    id_user,
                    id_user_penjual,
                    nama_pembeli,
                    tanggal,
                    total_harga: Math.floor(Number(total_harga)),
                    metode_pembayaran
                },
                { where: { id_htrans_jual }, transaction: t }
            );

            // 4️⃣ Siapkan list stok untuk update marketplace
            const stokUpdateList = [];

            // 5️⃣ Hapus item lama yang tidak ada di detail baru (restore stok)
            for (const oldItem of oldDetails) {
                const key = `${oldItem.id_produk}_${oldItem.satuan}`;
                const stillExists = detail.find(d => `${d.id_produk}_${d.satuan}` === key);

                if (!stillExists) {
                    const stok = await Stok.findOne({
                        where: { id_product_stok: oldItem.id_produk, satuan: oldItem.satuan },
                        transaction: t
                    });

                    if (stok) {
                        const stokBaru = stok.stok + Number(oldItem.jumlah_barang);
                        await stok.update({ stok: stokBaru }, { transaction: t });
                        stokUpdateList.push(stok);
                    }

                    await DTransJual.destroy({
                        where: { id_dtrans_jual: oldItem.id_dtrans_jual },
                        transaction: t
                    });
                }
            }

            // 6️⃣ Tambah / ubah item di detail baru
            for (const item of detail) {
                const key = `${item.id_produk}_${item.satuan}`;
                const oldItem = oldDetailMap[key];
                const jumlahBaru = Number(item.jumlah_barang);

                const stok = await Stok.findOne({
                    where: { id_product_stok: item.id_produk, satuan: item.satuan },
                    transaction: t
                });

                if (!stok) throw new Error(`Stok tidak ditemukan untuk produk ${item.id_produk} (${item.satuan})`);

                if (oldItem) {
                    // Update stok berdasarkan selisih
                    const selisih = jumlahBaru - oldItem.jumlah_barang;
                    if (selisih !== 0) {
                        const stokBaru = stok.stok - selisih;
                        if (stokBaru < 0) throw new Error(`Stok tidak cukup untuk ${item.id_produk} (${item.satuan})`);
                        await stok.update({ stok: stokBaru }, { transaction: t });
                        stokUpdateList.push(stok);
                    }

                    // Update DTrans
                    await DTransJual.update(
                        {
                            jumlah_barang: jumlahBaru,
                            harga_satuan: Number(item.harga_satuan),
                            subtotal: Math.floor(Number(item.subtotal))
                        },
                        { where: { id_dtrans_jual: oldItem.id_dtrans_jual }, transaction: t }
                    );

                } else {
                    // Item baru → kurangi stok + buat DTrans baru
                    if (stok.stok < jumlahBaru)
                        throw new Error(`Stok tidak cukup untuk ${item.id_produk} (${item.satuan})`);
                    const stokBaru = stok.stok - jumlahBaru;
                    await stok.update({ stok: stokBaru }, { transaction: t });
                    stokUpdateList.push(stok);

                    const id_dtrans_jual = await generateDTransJualId();
                    await DTransJual.create(
                        {
                            id_dtrans_jual,
                            id_htrans_jual,
                            id_produk: item.id_produk,
                            satuan: item.satuan,
                            jumlah_barang: jumlahBaru,
                            harga_satuan: Number(item.harga_satuan),
                            subtotal: Math.floor(Number(item.subtotal))
                        },
                        { transaction: t }
                    );
                }
            }

            // ✅ Commit transaksi database
            await t.commit();

            // 🔁 Ambil stok terbaru untuk sinkronisasi
            const freshStokList = await Promise.all(
                stokUpdateList.map(async s => await Stok.findByPk(s.id_stok))
            );

            // 🔄 Update ke marketplace (Shopee + Lazada)
            (async () => {
                for (const stok of freshStokList) {
                    if (!stok) continue;

                    try {
                        // 🟠 Shopee
                        if (stok.id_product_shopee && stok.id_product_shopee !== '' && !isNaN(stok.stok)) {
                            await axios.post("https://tokalphaomegaploso.my.id/api/shopee/update-stock", {
                                item_id: Number(stok.id_product_shopee),
                                stock: Number(stok.stok)
                            });
                        } else {
                            console.log(`⏭️ Skip Shopee: produk ${stok.id_product_stok} tidak punya id_product_shopee`);
                        }

                        // 🔵 Lazada
                        if (stok.id_product_lazada && stok.id_product_lazada !== '' && !isNaN(stok.stok)) {
                            await axios.post("https://tokalphaomegaploso.my.id/api/lazada/update-stock", {
                                item_id: String(stok.id_product_lazada),
                                sku_id: String(stok.sku_lazada),
                                quantity: Number(stok.stok)
                            });
                        } else {
                            console.log(`⏭️ Skip Lazada: produk ${stok.id_product_stok} tidak punya id_product_lazada/sku_lazada`);
                        }
                    } catch (err) {
                        console.error("❌ Gagal update stok marketplace (updateTransaction):", {
                            produk: stok.id_product_stok,
                            error: err.response?.data || err.message
                        });
                    }
                }
            })();

            // 🔔 Emit notifikasi realtime ke penjual
            if (global.io && id_user_penjual) {
                global.io.to(String(id_user_penjual)).emit("updateTransaction", {
                    id_htrans_jual,
                    nama_pembeli,
                    total_harga,
                    detail,
                    message: `Transaksi ${id_htrans_jual} telah diperbarui`
                });
            }

            // ✅ Response sukses
            res.status(200).json({
                success: true,
                message: "Transaksi berhasil diperbarui",
                id_htrans_jual
            });

            // 🔔 Kirim notifikasi eksternal (opsional)
            axios.post(NOTIF_URL, {
                title: "Pesanan Diperbarui",
                message: `Pesanan ${nama_pembeli} telah diperbarui. Mohon segera dicek.`
            }).catch(err => console.error("Gagal kirim notifikasi eksternal:", err.message));

        } catch (error) {
            await t.rollback();
            console.error("❌ Update Transaction Error:", error);
            res.status(500).json({ success: false, message: error.message });
        }
    },

    updateStatusTransaction: async (req, res) => {
        const t = await HTransJual.sequelize.transaction();
        try {
            const { id_htrans_jual } = req.params;

            console.log("🔵 Update Status Transaction:", id_htrans_jual, "→ Lunas");

            // 1️⃣ Cari transaksi berdasarkan ID
            const transaksi = await HTransJual.findByPk(id_htrans_jual, { transaction: t });
            if (!transaksi) {
                await t.rollback();
                return res.status(404).json({
                    success: false,
                    message: `Transaksi ${id_htrans_jual} tidak ditemukan`,
                });
            }

            // 2️⃣ Cegah update jika sudah Lunas
            if (transaksi.status === "Lunas") {
                await t.rollback();
                return res.status(200).json({
                    success: true,
                    message: `Status transaksi sudah 'Lunas'`,
                    id_htrans_jual,
                });
            }

            // 3️⃣ Update status jadi Lunas
            await transaksi.update(
                { status: "Lunas" },
                { transaction: t }
            );

            await t.commit();

            // 4️⃣ Kirim notifikasi realtime ke penjual
            if (global.io && transaksi.id_user_penjual) {
                global.io.to(String(transaksi.id_user_penjual)).emit("updateStatusTransaction", {
                    id_htrans_jual,
                    status: "Lunas",
                    message: `Status transaksi ${id_htrans_jual} telah diubah menjadi Lunas`,
                });
            }

            // 5️⃣ Response sukses
            res.status(200).json({
                success: true,
                message: `Status transaksi berhasil diubah menjadi 'Lunas'`,
                id_htrans_jual,
            });

        } catch (error) {
            await t.rollback();
            console.error("❌ Update Status Transaction Error:", error);
            res.status(500).json({
                success: false,
                message: error.message,
            });
        }
    },

    getPendingTransactions: async (req, res) => {
        try {
            const transaksiPending = await HTransJual.findAll({
                where: {
                    status: "Pending",
                    sumber_transaksi: "Offline" // 🔹 Tambahkan filter ini
                },
                include: [
                    {
                        model: DTransJual,
                        as: "detail_transaksi",
                    },
                    {
                        model: User,
                        as: "user",
                        attributes: ["name"], // Nama pembeli
                    },
                    {
                        model: User,
                        as: "penjual",
                        attributes: ["name"], // Nama pegawai
                    },
                ],
            });

            res.json(transaksiPending);
        } catch (error) {
            console.error("Error getPendingTransactions:", error);
            res.status(500).json({ message: error.message });
        }
    },

    getLunasTransactions: async (req, res) => {
        try {
            const transaksiLunas = await HTransJual.findAll({
                where: { status: "Lunas" },
                include: "detail_transaksi",
            });

            res.json(transaksiLunas);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    getDetailTransactionByHeaderId: async (req, res) => {
        try {
            const { id_htrans } = req.params;
            const details = await DTransJual.findAll({
                where: { id_htrans_jual: id_htrans }
            });

            res.json(details);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    getPendingTransactionsByPenjual: async (req, res) => {
        try {
            const { id_user_penjual } = req.body; // dikirim dari frontend

            if (!id_user_penjual) {
                return res.status(400).json({ message: "id_user_penjual diperlukan" });
            }

            const transaksiPending = await HTransJual.findAll({
                where: {
                    status: "Pending",
                    sumber_transaksi: "Offline", // 🔹 Tambahkan filter sumber_transaksi
                    id_user_penjual: id_user_penjual,
                },
                include: [
                    {
                        model: DTransJual,
                        as: "detail_transaksi",
                    },
                    {
                        model: User,
                        as: "user",
                        attributes: ["name"], // Nama pembeli
                    },
                    {
                        model: User,
                        as: "penjual",
                        attributes: ["name"], // Nama pegawai
                    },
                ],
            });

            res.json(transaksiPending);
        } catch (error) {
            console.error("Error getPendingTransactionsByPenjual:", error);
            res.status(500).json({ message: error.message });
        }
    },

};

module.exports = TransJualController;
