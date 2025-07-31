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
        try {
            const { id_supplier, tanggal, total_harga, metode_pembayaran, nomor_invoice, ppn, detail } = req.body;

            // Generate ID untuk htrans_beli
            const id_htrans_beli = await generateHTransBeliId();

            // Buat transaksi utama
            const newTransaction = await HTransBeli.create({
                id_htrans_beli,
                id_supplier,
                tanggal,
                total_harga,
                metode_pembayaran,
                nomor_invoice,
                ppn
            });

            // Looping untuk setiap detail transaksi
            for (const item of detail) {
                const id_dtrans_beli = await generateDTransBeliId(); // Generate ID untuk detail transaksi

                await DTransBeli.create({
                    id_dtrans_beli,
                    id_htrans_beli,
                    id_produk: item.id_produk,
                    jumlah_barang: item.jumlah_barang,
                    harga_satuan: item.harga_satuan,
                    diskon_barang: item.diskon_barang,
                    subtotal: item.subtotal,
                });

                // Update stok di tabel stok
                const stock = await Stok.findOne({ where: { id_product_stok: item.id_produk } });
                if (stock) {
                    await stock.update({ stok: stock.stok + item.jumlah_barang });
                } else {
                    // Jika stok belum ada, tambahkan data stok baru
                    await Stok.create({
                        id_stok: await generateStokId(),
                        id_product_stok: item.id_produk,
                        satuan: item.satuan, // Pastikan satuan dikirim dari frontend
                        stok: item.jumlah_barang,
                        harga: item.harga_satuan
                    });
                }
            }

            res.status(201).json({ message: "Transaction created successfully" });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },
};

module.exports = TransBeliController;
