const { HTransBeli } = require("../model/htrans_beli_model");
const { DTransBeli } = require("../model/dtrans_beli_model");
const { Stok } = require("../model/stok_model");

// Fungsi untuk generate ID htrans_beli (HTR000001)
async function generateHTransBeliId() {
    const lastTransaction = await HTransBeli.findOne({ order: [['id_htrans_beli', 'DESC']] });
    let newId = "HTB000001";
    if (lastTransaction) {
        const lastIdNum = parseInt(lastTransaction.id_htrans_beli.replace("HTB", ""), 10);
        newId = `HTB${String(lastIdNum + 1).padStart(6, "0")}`;
    }
    return newId;
}

// Fungsi untuk generate ID dtrans_beli (DTR000001)
async function generateDTransBeliId() {
    const lastDetail = await DTransBeli.findOne({ order: [['id_dtrans_beli', 'DESC']] });
    let newId = "DTB000001";
    if (lastDetail) {
        const lastIdNum = parseInt(lastDetail.id_dtrans_beli.replace("DTB", ""), 10);
        newId = `DTB${String(lastIdNum + 1).padStart(6, "0")}`;
    }
    return newId;
}

const TransBeliController = {
    // Mendapatkan semua transaksi pembelian
    getAllTransactions: async (req, res) => {
        try {
            const transactions = await HTransBeli.findAll({ include: "detail_transaksi" });
            res.json(transactions);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    // Mendapatkan transaksi pembelian berdasarkan ID
    getTransactionById: async (req, res) => {
        try {
            const { id } = req.params;
            const transaction = await HTransBeli.findByPk(id, { include: "detail_transaksi" });

            if (!transaction) return res.status(404).json({ message: "Transaction not found" });

            res.json(transaction);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    // Membuat transaksi pembelian baru dengan auto-generated ID
    createTransaction: async (req, res) => {
        const t = await HTransBeli.sequelize.transaction();
        try {
            const {
                id_supplier,
                tanggal,
                total_harga,
                metode_pembayaran,
                nomor_invoice,
                ppn,
                detail
            } = req.body;

            // 1️⃣ Generate ID Header Transaksi
            const id_htrans_beli = await generateHTransBeliId();

            // 2️⃣ Buat Header Transaksi
            await HTransBeli.create(
                {
                    id_htrans_beli,
                    id_supplier,
                    tanggal,
                    total_harga: Math.floor(Number(total_harga)),
                    metode_pembayaran,
                    nomor_invoice,
                    ppn: Number(ppn) || 0,
                },
                { transaction: t }
            );

            // 3️⃣ Penampung untuk sinkron stok nanti
            const stokUpdateList = [];

            // 4️⃣ Proses detail transaksi pembelian
            for (const item of detail) {
                const id_dtrans_beli = await generateDTransBeliId();

                // Simpan detail transaksi
                await DTransBeli.create(
                    {
                        id_dtrans_beli,
                        id_htrans_beli,
                        id_produk: item.id_produk,
                        jumlah_barang: Number(item.jumlah_barang),
                        harga_satuan: Number(item.harga_satuan),
                        diskon_barang: Number(item.diskon_barang) || 0,
                        subtotal: Math.floor(Number(item.subtotal)),
                    },
                    { transaction: t }
                );

                // 🧮 Update atau buat stok
                let stok = await Stok.findOne({
                    where: { id_product_stok: item.id_produk, satuan: item.satuan },
                    transaction: t,
                });

                if (stok) {
                    const stokBaru = stok.stok + Number(item.jumlah_barang);
                    await stok.update(
                        { stok: stokBaru, harga: Number(item.harga_satuan) },
                        { transaction: t }
                    );
                    stokUpdateList.push(stok);
                } else {
                    // Jika stok belum ada
                    const id_stok = await generateStokId();
                    stok = await Stok.create(
                        {
                            id_stok,
                            id_product_stok: item.id_produk,
                            satuan: item.satuan,
                            stok: Number(item.jumlah_barang),
                            harga: Number(item.harga_satuan),
                        },
                        { transaction: t }
                    );
                    stokUpdateList.push(stok);
                }
            }

            // ✅ Commit transaksi lokal
            await t.commit();

            // 🔄 Ambil stok terbaru
            const freshStokList = await Promise.all(
                stokUpdateList.map(async (s) => await Stok.findByPk(s.id_stok))
            );

            // 🚀 Sinkron ke marketplace (Shopee & Lazada)
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
                            console.log(`🟢 Shopee stok updated [${stok.id_product_stok}] → ${stok.stok}`);
                        } else {
                            console.log(`⏭️ Skip Shopee: produk ${stok.id_product_stok} belum punya id_product_shopee`);
                        }

                        // 🔵 Lazada
                        if (stok.id_product_lazada && stok.id_product_lazada !== '' && !isNaN(stok.stok)) {
                            await axios.post("https://tokalphaomegaploso.my.id/api/lazada/update-stock", {
                                item_id: String(stok.id_product_lazada),
                                sku_id: String(stok.sku_lazada),
                                quantity: Number(stok.stok)
                            });
                            console.log(`🟣 Lazada stok updated [${stok.id_product_stok}] → ${stok.stok}`);
                        } else {
                            console.log(`⏭️ Skip Lazada: produk ${stok.id_product_stok} belum punya id_product_lazada/sku_lazada`);
                        }
                    } catch (err) {
                        console.error("❌ Gagal update stok marketplace (createTransactionBeli):", {
                            produk: stok.id_product_stok,
                            error: err.response?.data || err.message,
                        });
                    }
                }
            })();

            // ✅ Response sukses
            res.status(201).json({
                success: true,
                message: "Transaksi pembelian berhasil dibuat dan stok diperbarui",
                id_htrans_beli,
            });
        } catch (error) {
            await t.rollback();
            console.error("❌ Gagal createTransactionBeli:", error);
            res.status(500).json({
                success: false,
                message: error.message || "Gagal membuat transaksi pembelian",
            });
        }
    },
};

module.exports = TransBeliController;
