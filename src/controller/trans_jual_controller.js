const { HTransJual } = require("../model/htrans_jual_model");
const { DTransJual } = require("../model/dtrans_jual_model");
const { Stok } = require("../model/stok_model");
const { User } = require('../model/user_model');
const { Op } = require("sequelize");

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
            let stokTidakCukup = [];

            for (const item of detail) {
                const stock = await Stok.findOne({
                    where: {
                        id_product_stok: item.id_produk,
                        satuan: item.satuan,
                    }
                });

                if (!stock || stock.stok < item.jumlah_barang) {
                    stokTidakCukup.push({
                        id_produk: item.id_produk,
                        satuan: item.satuan,
                        stok_tersedia: stock ? stock.stok : 0,
                        jumlah_diminta: item.jumlah_barang,
                    });
                }
            }

            if (stokTidakCukup.length > 0) {
                return res.status(400).json({
                    message: "Transaksi dibatalkan. Beberapa produk memiliki stok tidak mencukupi.",
                    stok_tidak_cukup: stokTidakCukup
                });
            }

            const id_htrans_jual = await generateHTransJualId();
            const nomor_invoice = await generateInvoiceNumber();

            const newTransaction = await HTransJual.create({
                id_htrans_jual,
                id_user,
                id_user_penjual,
                nama_pembeli,
                tanggal,
                total_harga,
                metode_pembayaran,
                nomor_invoice,
                status: "Pending",
            });

            for (const item of detail) {
                const id_dtrans_jual = await generateDTransJualId();

                await DTransJual.create({
                    id_dtrans_jual,
                    id_htrans_jual,
                    id_produk: item.id_produk,
                    satuan: item.satuan,
                    jumlah_barang: item.jumlah_barang,
                    harga_satuan: item.harga_satuan,
                    subtotal: item.subtotal,
                });

                const stock = await Stok.findOne({
                    where: {
                        id_product_stok: item.id_produk,
                        satuan: item.satuan,
                    }
                });

                await stock.update({ stok: stock.stok - item.jumlah_barang });
            }

            return res.status(201).json({
                message: "Transaksi jual berhasil dibuat",
                invoice: nomor_invoice,
                id_htrans_jual,
            });

        } catch (error) {
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

            console.log("PARAM ID:", id_htrans_jual);
            console.log("BODY:", req.body);

            // 1. Ambil detail lama
            const oldDetails = await DTransJual.findAll({
                where: { id_htrans_jual },
                transaction: t
            });

            // 2. Buat map detail lama
            const oldDetailMap = {};
            oldDetails.forEach(item => {
                const key = `${item.id_produk}_${item.satuan}`;
                oldDetailMap[key] = item;
            });

            // 3. Buat map detail baru
            const newDetailMap = {};
            detail.forEach(item => {
                const key = `${item.id_produk}_${item.satuan}`;
                newDetailMap[key] = item;
            });

            // 4. Update header transaksi
            await HTransJual.update(
                {
                    id_user,
                    id_user_penjual,
                    nama_pembeli,
                    tanggal,
                    total_harga,
                    metode_pembayaran
                },
                { where: { id_htrans_jual }, transaction: t }
            );

            // 5. Proses item lama → hapus jika tidak ada di detail baru
            for (const oldItem of oldDetails) {
                const key = `${oldItem.id_produk}_${oldItem.satuan}`;
                const newItem = newDetailMap[key];

                // Barang lama yang dihapus
                if (!newItem) {
                    // Kembalikan stok penuh
                    const stok = await Stok.findOne({
                        where: {
                            id_product_stok: oldItem.id_produk,
                            satuan: oldItem.satuan
                        },
                        transaction: t
                    });
                    if (stok) {
                        await stok.update(
                            { stok: stok.stok + oldItem.jumlah_barang },
                            { transaction: t }
                        );
                    }

                    // Hapus dari tabel detail
                    await DTransJual.destroy({
                        where: { id_dtrans_jual: oldItem.id_dtrans_jual },
                        transaction: t
                    });
                }
            }

            // 6. Proses item baru atau update jumlah lama
            for (const item of detail) {
                const key = `${item.id_produk}_${item.satuan}`;
                const oldItem = oldDetailMap[key];

                if (oldItem) {
                    // Barang lama → hitung selisih
                    const selisih = item.jumlah_barang - oldItem.jumlah_barang;

                    if (selisih !== 0) {
                        const stok = await Stok.findOne({
                            where: {
                                id_product_stok: item.id_produk,
                                satuan: item.satuan
                            },
                            transaction: t
                        });

                        if (!stok) throw new Error(`Stok tidak ditemukan untuk ${item.id_produk} (${item.satuan})`);

                        // Jika nambah barang cek stok
                        if (selisih > 0 && stok.stok < selisih) {
                            throw new Error(`Stok tidak cukup untuk ${item.id_produk} (${item.satuan})`);
                        }

                        // Update stok
                        await stok.update(
                            { stok: stok.stok - selisih },
                            { transaction: t }
                        );
                    }

                    // Update detail lama
                    await DTransJual.update(
                        {
                            jumlah_barang: item.jumlah_barang,
                            harga_satuan: item.harga_satuan,
                            subtotal: item.subtotal
                        },
                        {
                            where: { id_dtrans_jual: oldItem.id_dtrans_jual },
                            transaction: t
                        }
                    );
                } else {
                    // Barang baru → insert + kurangi stok
                    const stok = await Stok.findOne({
                        where: {
                            id_product_stok: item.id_produk,
                            satuan: item.satuan
                        },
                        transaction: t
                    });

                    if (!stok) throw new Error(`Stok tidak ditemukan untuk ${item.id_produk} (${item.satuan})`);
                    if (stok.stok < item.jumlah_barang) throw new Error(`Stok tidak cukup untuk ${item.id_produk} (${item.satuan})`);

                    await stok.update(
                        { stok: stok.stok - item.jumlah_barang },
                        { transaction: t }
                    );

                    const id_dtrans_jual = await generateDTransJualId();
                    await DTransJual.create(
                        {
                            id_dtrans_jual,
                            id_htrans_jual,
                            id_produk: item.id_produk,
                            satuan: item.satuan,
                            jumlah_barang: item.jumlah_barang,
                            harga_satuan: item.harga_satuan,
                            subtotal: item.subtotal
                        },
                        { transaction: t }
                    );
                }
            }

            await t.commit();
            res.json({ message: "Transaksi berhasil diperbarui" });
        } catch (error) {
            await t.rollback();
            console.error("Update Transaction Error:", error);
            res.status(500).json({ message: error.message });
        }
    },

    getPendingTransactions: async (req, res) => {
        try {
            const transaksiPending = await HTransJual.findAll({
                where: { status: "Pending" },
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

};

module.exports = TransJualController;
