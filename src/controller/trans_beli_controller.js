const { HTransBeli } = require("../model/htrans_beli_model");
const { DTransBeli } = require("../model/dtrans_beli_model");
const { Product } = require("../model/product_model");
const { Stok } = require("../model/stok_model");
const axios = require("axios");

// Fungsi untuk generate ID htrans_beli (HTR000001)
async function generateHTransBeliId() {
    const prefix = "HTB";

    const last = await HTransBeli.findOne({
        order: [['id_htrans_beli', 'DESC']]
    });

    let number = 1;

    if (last) {
        const lastNum = parseInt(last.id_htrans_beli.replace(prefix, ""), 10) || 0;
        number = lastNum + 1;
    }

    return `${prefix}${String(number).padStart(6, "0")}`;
}

// Fungsi untuk generate ID dtrans_beli (DTR000001)
async function generateDTransBeliId() {
    const prefix = "DTB";

    const last = await DTransBeli.findOne({
        order: [['id_dtrans_beli', 'DESC']]
    });

    let number = 1;

    if (last) {
        const lastNum = parseInt(last.id_dtrans_beli.replace(prefix, ""), 10) || 0;
        number = lastNum + 1;
    }

    // Random 3 digit (000–999)
    const rand = Math.floor(Math.random() * 1000)
        .toString()
        .padStart(3, "0");

    // Format: DTB000001123
    return `${prefix}${String(number).padStart(6, "0")}${rand}`;
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

            const transaction = await HTransBeli.findByPk(id, {
                include: [
                    {
                        model: DTransBeli,
                        as: "detail_transaksi",
                        include: [
                            {
                                model: Product,
                                as: "produk",
                                attributes: ["id_product", "nama_product", "gambar_product"],
                                include: [
                                    {
                                        model: Stok,
                                        as: "stok",
                                        attributes: ["satuan", "harga", "harga_beli"],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });

            if (!transaction) {
                return res.status(404).json({ message: "Transaction not found" });
            }

            res.json(transaction);
        } catch (error) {
            console.error("❌ Error getTransactionById:", error);
            res.status(500).json({ message: error.message });
        }
    },

    // Membuat transaksi pembelian baru dengan auto-generated ID
    createTransaction: async (req, res) => {
        const t = await HTransBeli.sequelize.transaction();

        try {
            console.log("📥 Incoming BODY:", req.body);

            let {
                id_supplier,
                tanggal,
                total_harga,
                metode_pembayaran,
                nomor_invoice,
                ppn,
                detail,
                detail_transaksi
            } = req.body;

            // Merge key
            detail = detail || detail_transaksi;

            // ============= PARSING =================
            if (!detail) {
                return res.status(400).json({
                    success: false,
                    message: "detail wajib diisi"
                });
            }

            // Jika masih string → parse
            if (typeof detail === "string") {
                try {
                    detail = JSON.parse(detail);
                } catch (e) {
                    return res.status(400).json({
                        success: false,
                        message: "Format detail tidak valid"
                    });
                }
            }

            // Jika object → extract values
            if (!Array.isArray(detail)) {
                detail = Object.values(detail);
            }

            if (!Array.isArray(detail) || detail.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "detail harus array berisi 1 item atau lebih"
                });
            }

            // ============= VALIDATION =================
            for (const d of detail) {
                if (!d.id_produk || !d.jumlah_barang || !d.harga_satuan || !d.subtotal || !d.satuan) {
                    return res.status(400).json({
                        success: false,
                        message: `Data detail tidak lengkap: ${JSON.stringify(d)}`
                    });
                }
            }

            // ============= INSERT HEADER =================
            const id_htrans_beli = await generateHTransBeliId();
            await HTransBeli.create({
                id_htrans_beli,
                id_supplier,
                tanggal,
                total_harga: Number(total_harga),
                metode_pembayaran,
                nomor_invoice,
                ppn: Number(ppn) || 0,
            }, { transaction: t });

            // ============= INSERT DETAIL =================
            const stokIds = [];   // hanya simpan id_stok, bukan object mentah

            for (const item of detail) {
                const id_dtrans_beli = await generateDTransBeliId();

                await DTransBeli.create({
                    id_dtrans_beli,
                    id_htrans_beli,
                    id_produk: item.id_produk,
                    jumlah_barang: Number(item.jumlah_barang),
                    harga_satuan: Number(item.harga_satuan),
                    diskon_barang: Number(item.diskon_barang) || 0,
                    subtotal: Number(item.subtotal),
                }, { transaction: t });

                // ===== UPDATE CREATE STOCK =====
                let stok = await Stok.findOne({
                    where: {
                        id_product_stok: item.id_produk,
                        satuan: item.satuan
                    },
                    transaction: t
                });

                if (stok) {
                    await stok.update({
                        stok: stok.stok + Number(item.jumlah_barang),
                        harga: Number(item.harga_satuan),
                        harga_beli: Number(item.harga_satuan),
                    }, { transaction: t });

                    stokIds.push(stok.id_stok);
                } else {
                    const id_stok = await generateStokId();

                    await Stok.create({
                        id_stok,
                        id_product_stok: item.id_produk,
                        satuan: item.satuan,
                        stok: Number(item.jumlah_barang),
                        harga: Number(item.harga_satuan),
                        harga_beli: Number(item.harga_satuan),
                    }, { transaction: t });

                    stokIds.push(id_stok);
                }
            }

            // Commit dulu baru sync marketplace
            await t.commit();

            // ================== SYNC MARKETPLACE ===================
            const marketplaceResult = { shopee: [], lazada: [] };

            for (const id_stok of stokIds) {
                const fresh = await Stok.findByPk(id_stok);
                if (!fresh) continue;

                // Shopee
                if (fresh.id_product_shopee) {
                    try {
                        await axios.post("https://tokalphaomegaploso.my.id/api/shopee/update-stock", {
                            item_id: Number(fresh.id_product_shopee),
                            stock: Number(fresh.stok)
                        });
                        marketplaceResult.shopee.push({ produk: fresh.id_product_stok, status: "success" });
                    } catch (e) {
                        marketplaceResult.shopee.push({ produk: fresh.id_product_stok, status: "failed", error: e.message });
                    }
                }

                // Lazada
                if (fresh.id_product_lazada && fresh.sku_lazada) {
                    try {
                        await axios.post("https://tokalphaomegaploso.my.id/api/lazada/update-stock", {
                            item_id: String(fresh.id_product_lazada),
                            sku_id: String(fresh.sku_lazada),
                            quantity: Number(fresh.stok)
                        });
                        marketplaceResult.lazada.push({ produk: fresh.id_product_stok, status: "success" });
                    } catch (e) {
                        marketplaceResult.lazada.push({ produk: fresh.id_product_stok, status: "failed", error: e.message });
                    }
                }
            }

            return res.status(201).json({
                success: true,
                message: "Transaksi pembelian berhasil dibuat",
                id_htrans_beli,
                marketplace: marketplaceResult
            });

        } catch (err) {
            await t.rollback();
            console.error("❌ ERROR createTransaction:", err.message);
            return res.status(500).json({ success: false, message: err.message });
        }
    },

    updateTransaction: async (req, res) => {
        const t = await HTransBeli.sequelize.transaction();

        try {
            let {
                id_htrans_beli,
                id_supplier,
                tanggal,
                total_harga,
                metode_pembayaran,
                nomor_invoice,
                ppn,
                detail,
                detail_transaksi
            } = req.body;

            // Merge key (sama seperti create)
            detail = detail || detail_transaksi;

            // Basic required
            if (!id_htrans_beli) {
                return res.status(400).json({ success: false, message: "id_htrans_beli wajib diisi" });
            }

            // ============= PARSING (identik create) =================
            if (!detail) {
                return res.status(400).json({
                    success: false,
                    message: "detail wajib diisi"
                });
            }

            if (typeof detail === "string") {
                try {
                    detail = JSON.parse(detail);
                } catch (e) {
                    return res.status(400).json({
                        success: false,
                        message: "Format detail tidak valid (bukan JSON)"
                    });
                }
            }

            if (!Array.isArray(detail)) {
                detail = Object.values(detail);
            }

            if (detail.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "detail tidak boleh kosong"
                });
            }

            // Validate each detail and ensure satuan is non-empty string
            for (let i = 0; i < detail.length; i++) {
                const d = detail[i];
                if (!d.id_produk || d.jumlah_barang == null || d.harga_satuan == null || d.subtotal == null) {
                    return res.status(400).json({
                        success: false,
                        message: `Data detail tidak lengkap pada index ${i}: ${JSON.stringify(d)}`
                    });
                }

                // stricter check for satuan
                if (typeof d.satuan !== 'string' || d.satuan.trim() === '') {
                    return res.status(400).json({
                        success: false,
                        message: `Field 'satuan' wajib diisi (tidak boleh kosong) pada detail index ${i}, produk: ${d.id_produk}`
                    });
                }

                // normalize satuan (trim)
                d.satuan = d.satuan.trim();
            }

            // ============= AMBIL TRANSAKSI =============
            const existing = await HTransBeli.findByPk(id_htrans_beli, {
                include: [{ model: DTransBeli, as: "detail_transaksi" }],
                transaction: t,
            });

            if (!existing) {
                await t.rollback();
                return res.status(404).json({ success: false, message: "Transaksi tidak ditemukan" });
            }

            const oldDetails = existing.detail_transaksi || [];

            // ============= ROLLBACK STOK LAMA (safe: skip if satuan missing) =============
            for (const oldItem of oldDetails) {
                if (!oldItem || oldItem.id_produk == null) {
                    console.warn("[updateTransaction] skip oldItem karena tidak valid:", oldItem);
                    continue;
                }

                // jika satuan tidak ada di record lama, skip dan log
                if (typeof oldItem.satuan !== 'string' || oldItem.satuan.trim() === '') {
                    console.warn(`[updateTransaction] old detail missing satuan, skip rollback for product ${oldItem.id_produk}`);
                    continue;
                }

                const stok = await Stok.findOne({
                    where: {
                        id_product_stok: oldItem.id_produk,
                        satuan: oldItem.satuan
                    },
                    transaction: t,
                });

                if (stok) {
                    await stok.update({
                        stok: Math.max(stok.stok - Number(oldItem.jumlah_barang), 0)
                    }, { transaction: t });
                } else {
                    console.warn(`[updateTransaction] stok not found for ${oldItem.id_produk} / ${oldItem.satuan} during rollback`);
                }
            }

            // ============= UPDATE HEADER =================
            await existing.update({
                id_supplier,
                tanggal,
                total_harga: Number(total_harga),
                metode_pembayaran,
                nomor_invoice,
                ppn: Number(ppn) || 0,
            }, { transaction: t });

            // ============= HAPUS DETAIL LAMA =============
            await DTransBeli.destroy({
                where: { id_htrans_beli },
                transaction: t,
            });

            // ============= INSERT DETAIL BARU (identik create) =============
            const stokIds = [];

            for (const item of detail) {
                // safety: ensure item.satuan already normalized
                if (typeof item.satuan !== 'string' || item.satuan.trim() === '') {
                    // this should not happen due validation above, but double-check
                    await t.rollback();
                    return res.status(400).json({
                        success: false,
                        message: `Satuan tidak boleh kosong untuk produk ${item.id_produk}`
                    });
                }

                const id_dtrans_beli = await generateDTransBeliId();

                await DTransBeli.create({
                    id_dtrans_beli,
                    id_htrans_beli,
                    id_produk: item.id_produk,
                    jumlah_barang: Number(item.jumlah_barang),
                    harga_satuan: Number(item.harga_satuan),
                    diskon_barang: Number(item.diskon_barang) || 0,
                    subtotal: Number(item.subtotal),
                    satuan: item.satuan
                }, { transaction: t });

                // === UPDATE / CREATE STOK (sama persis create) ===
                let stok = await Stok.findOne({
                    where: {
                        id_product_stok: item.id_produk,
                        satuan: item.satuan
                    },
                    transaction: t
                });

                if (stok) {
                    await stok.update({
                        stok: stok.stok + Number(item.jumlah_barang),
                        harga: Number(item.harga_satuan),
                        harga_beli: Number(item.harga_satuan),
                    }, { transaction: t });

                    stokIds.push(stok.id_stok);
                } else {
                    const id_stok = await generateStokId();

                    const created = await Stok.create({
                        id_stok,
                        id_product_stok: item.id_produk,
                        satuan: item.satuan,
                        stok: Number(item.jumlah_barang),
                        harga: Number(item.harga_satuan),
                        harga_beli: Number(item.harga_satuan),
                    }, { transaction: t });

                    stokIds.push(created.id_stok);
                }
            }

            // ============= COMMIT =============
            await t.commit();

            // ============= SYNC MARKETPLACE (identik create) =============
            const marketplaceResult = { shopee: [], lazada: [] };

            for (const id_stok of stokIds) {
                const fresh = await Stok.findByPk(id_stok);
                if (!fresh) continue;

                try {
                    if (fresh.id_product_shopee) {
                        await axios.post("https://tokalphaomegaploso.my.id/api/shopee/update-stock", {
                            item_id: Number(fresh.id_product_shopee),
                            stock: Number(fresh.stok)
                        });
                        marketplaceResult.shopee.push({ produk: fresh.id_product_stok, status: "success" });
                    }

                    if (fresh.id_product_lazada && fresh.sku_lazada) {
                        await axios.post("https://tokalphaomegaploso.my.id/api/lazada/update-stock", {
                            item_id: String(fresh.id_product_lazada),
                            sku_id: String(fresh.sku_lazada),
                            quantity: Number(fresh.stok)
                        });
                        marketplaceResult.lazada.push({ produk: fresh.id_product_stok, status: "success" });
                    }
                } catch (e) {
                    console.error("Marketplace update fail:", e.message);
                    marketplaceResult.shopee.push({ produk: fresh.id_product_stok, status: "failed", error: e.message });
                }
            }

            return res.status(200).json({
                success: true,
                message: "Transaksi berhasil diperbarui",
                id_htrans_beli,
                marketplace: marketplaceResult
            });

        } catch (error) {
            await t.rollback();
            console.error("[updateTransaction] ERROR:", error);
            return res.status(500).json({
                success: false,
                message: error.message || "Gagal memperbarui transaksi pembelian"
            });
        }
    },

};

module.exports = TransBeliController;
