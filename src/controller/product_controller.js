const { Product } = require("../model/product_model");
const { Kategori } = require("../model/kategori_model");
const { Stok } = require("../model/stok_model");
const { Op } = require('sequelize');

async function generateProductId(productName) {
    const name = productName.replace(/[^a-zA-Z]/g, '').toUpperCase(); // hapus angka/spasi
    const prefix = (name[0] || 'X') + (name[1] || 'X'); // ambil 2 huruf pertama

    // Cari produk terakhir dengan prefix yang sama
    const lastProduct = await Product.findOne({
        where: {
            id_product: {
                [Op.like]: `${prefix}%`,
            },
        },
        order: [['id_product', 'DESC']],
    });

    let newNumber = 1;
    if (lastProduct) {
        const lastIdNum = parseInt(lastProduct.id_product.replace(prefix, ''), 10);
        newNumber = lastIdNum + 1;
    }

    return `${prefix}${String(newNumber).padStart(4, '0')}`;
}

const upload = require("../middleware/upload");

async function generateProductId(productName) {
    const name = productName.replace(/[^a-zA-Z]/g, '').toUpperCase(); // hapus angka/spasi
    const prefix = (name[0] || 'X') + (name[1] || 'X'); // ambil 2 huruf pertama

    // Cari produk terakhir dengan prefix yang sama
    const lastProduct = await Product.findOne({
        where: {
            id_product: {
                [Op.like]: `${prefix}%`,
            },
        },
        order: [['id_product', 'DESC']],
    });

    let newNumber = 1;
    if (lastProduct) {
        const lastIdNum = parseInt(lastProduct.id_product.replace(prefix, ''), 10);
        newNumber = lastIdNum + 1;
    }

    return `${prefix}${String(newNumber).padStart(4, '0')}`;
}

async function generateKategoriId() {
    const lastKategori = await Kategori.findOne({ order: [['id_kategori', 'DESC']] });

    let newId = 'KAT001';
    if (lastKategori) {
        const lastNumber = parseInt(lastKategori.id_kategori.replace('KAT', ''), 10);
        const nextNumber = lastNumber + 1;
        newId = `KAT${String(nextNumber).padStart(3, '0')}`;
    }

    return newId;
}

let stokCounter = null;

async function generateStokId() {
    if (stokCounter === null) {

        const lastStok = await Stok.findOne({
            order: [['id_stok', 'DESC']]
        });

        if (lastStok && lastStok.id_stok) {
            const lastNumber = parseInt(lastStok.id_stok.replace('STK', ''), 10);
            stokCounter = lastNumber + 1;
        } else {
            stokCounter = 1;
        }
    }

    const id = `STK${String(stokCounter).padStart(3, '0')}`;
    stokCounter++;
    return id;
}

const ProductController = {
    getAllProducts: async (req, res) => {
        try {
            const products = await Product.findAll({
                where: { aktif: true }, // ✅ hanya ambil yang aktif
            });

            const productsWithBase64 = products.map(product => ({
                ...product.toJSON(),
                gambar_product: product.gambar_product
                    ? `data:image/png;base64,${product.gambar_product.toString("base64")}`
                    : null,
            }));

            res.json(productsWithBase64);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    getProductById: async (req, res) => {
        try {
            const { id } = req.params;

            const product = await Product.findByPk(id, {
                include: [
                    {
                        model: Stok,
                        as: "stok",
                        where: {
                            id_product_stok: id,
                            aktif: true, // ✅ hanya ambil stok aktif
                        },
                        required: false,
                    },
                ],
            });

            if (!product) {
                return res.status(404).json({ message: "Product not found" });
            }

            const gambar_product = product.gambar_product
                ? `data:image/png;base64,${product.gambar_product.toString("base64")}`
                : null;

            const stok = product.stok?.length > 0
                ? product.stok.map((item) => ({
                    id_stok: item.id_stok,
                    satuan: item.satuan,
                    jumlah: item.stok,
                    harga: item.harga,
                    hargaBeli: item.harga_beli,
                    id_product_shopee: item.id_product_shopee,
                    id_product_lazada: item.id_product_lazada,
                    aktif: item.aktif, // ✅ boleh ikut ditampilkan agar frontend tahu status
                }))
                : [];

            res.status(200).json({
                ...product.toJSON(),
                gambar_product,
                stok,
            });

        } catch (error) {
            console.error("Error getProductById:", error);
            res.status(500).json({
                message: "Gagal mengambil data produk",
                error: error.message,
            });
        }
    },

    createProduct: async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ message: "Gambar produk wajib diunggah!" });
            }

            const gambarBuffer = req.file.buffer;
            let {
                product_kategori,
                nama_product,
                deskripsi_product,
                satuan_stok,
                harga
            } = req.body;

            // Validasi field dasar
            if (!product_kategori || !nama_product || !deskripsi_product || !satuan_stok || !harga) {
                return res.status(400).json({ message: "Semua field wajib diisi!" });
            }

            const newId = await generateProductId(nama_product);

            // Parse array
            let satuanArray, hargaArray;
            try {
                satuanArray = JSON.parse(satuan_stok);
                hargaArray = JSON.parse(harga);
            } catch (err) {
                return res.status(400).json({ message: "Format satuan_stok dan harga harus berupa JSON array!" });
            }

            // Validasi array
            if (!Array.isArray(satuanArray) || !Array.isArray(hargaArray) || satuanArray.length !== hargaArray.length) {
                return res.status(400).json({ message: "Jumlah satuan dan harga harus sama!" });
            }

            if (
                satuanArray.some(s => !s || typeof s !== "string") ||
                hargaArray.some(h => h === undefined || h === null || isNaN(parseInt(h)))
            ) {
                return res.status(400).json({ message: "Semua satuan dan harga harus valid!" });
            }

            // Validasi kategori
            const kategori = await Kategori.findOne({ where: { id_kategori: product_kategori } });
            if (!kategori) {
                return res.status(400).json({ message: "Kategori tidak ditemukan!" });
            }

            // Simpan produk
            await Product.create({
                id_product: newId,
                product_kategori,
                nama_product,
                gambar_product: gambarBuffer,
                deskripsi_product,
                id_product_shopee: null,
                id_product_lazada: null,
                sumber_transaksi: "offline", // ⬅️ Tambahan di sini
            });


            // Reset counter stok ID
            stokCounter = null;

            // Buat entri stok dengan ID unik
            const stokEntries = [];
            for (let i = 0; i < satuanArray.length; i++) {
                const id_stok = await generateStokId();
                stokEntries.push({
                    id_stok,
                    id_product_stok: newId,
                    satuan: satuanArray[i],
                    harga: parseInt(hargaArray[i]),
                    stok: 0
                });
            }

            // Simpan stok
            await Stok.bulkCreate(stokEntries);

            // Ambil ulang produk + stok
            const updatedProduct = await Product.findOne({
                where: { id_product: newId },
                include: [{ model: Stok, as: "stok" }],
            });

            const imageUrl = `data:image/png;base64,${gambarBuffer.toString('base64')}`;

            // === Response disesuaikan dengan model frontend (snake_case) ===
            return res.status(201).json({
                success: true,
                message: "Produk berhasil ditambahkan",
                data: {
                    id_product: updatedProduct.id_product,
                    product_kategori: updatedProduct.product_kategori,
                    nama_product: updatedProduct.nama_product,
                    gambar_product: imageUrl,
                    deskripsi_product: updatedProduct.deskripsi_product,
                    stok: updatedProduct.stok.map((item) => ({
                        satuan: item.satuan,
                        jumlah: item.stok, // frontend pakai "jumlah" bukan "stok"
                        harga: item.harga,
                    })),
                    kategori: kategori.nama_kategori,
                }
            });


        } catch (error) {
            console.error("❌ Error saat create produk:", error);
            return res.status(500).json({
                message: "Terjadi kesalahan server",
                error: error.message,
            });
        }
    },

    updateProduct: async (req, res) => {
        try {
            let { product_kategori, nama_product, deskripsi_product, stok_list } = req.body;

            // 🧩 Pastikan stok_list selalu berupa array of objects
            if (!Array.isArray(stok_list)) {
                if (typeof stok_list === "string") {
                    try {
                        stok_list = JSON.parse(stok_list);
                    } catch (error) {
                        return res.status(400).json({ message: "Format data stok_list harus berupa JSON array!" });
                    }
                } else {
                    return res.status(400).json({ message: "stok_list harus berupa array" });
                }
            }

            // 🔍 Validasi dan normalisasi setiap item
            stok_list = stok_list.map(item => ({
                satuan: item.satuan ?? "",
                stok: parseInt(item.jumlah) || 0,
                harga: parseInt(item.harga) || 0,
                hargaBeli: parseInt(item.harga_beli) || 0
            }));

            // 🔎 Pastikan kategori ada
            const kategori = await Kategori.findOne({ where: { id_kategori: product_kategori } });
            if (!kategori) {
                return res.status(400).json({ message: "Kategori tidak ditemukan!" });
            }

            // 🔎 Pastikan produk ada
            const product = await Product.findOne({ where: { id_product: req.params.id } });
            if (!product) {
                return res.status(404).json({ message: "Produk tidak ditemukan!" });
            }

            // 🖼️ Handle gambar
            let newImageBuffer = product.gambar_product;
            let imageUrl = "";
            if (req.file) {
                newImageBuffer = req.file.buffer;
                imageUrl = `data:image/png;base64,${newImageBuffer.toString("base64")}`;
            } else if (product.gambar_product) {
                imageUrl = `data:image/png;base64,${product.gambar_product.toString("base64")}`;
            }

            // ✏️ Update data produk utama
            await Product.update(
                { product_kategori, nama_product, deskripsi_product, gambar_product: newImageBuffer },
                { where: { id_product: req.params.id } }
            );

            // 📦 Ambil stok yang sudah ada
            const existingStok = await Stok.findAll({ where: { id_product_stok: req.params.id } });
            const stokMap = {};
            existingStok.forEach(item => {
                stokMap[item.satuan] = {
                    id: item.id_stok,
                    stok: item.stok,
                    harga: item.harga,
                    harga_beli: item.harga_beli
                };
            });

            // 🔄 Update stok lama / buat stok baru
            for (let stokItem of stok_list) {
                const { satuan, harga, stok, hargaBeli } = stokItem;

                if (stokMap[satuan]) {
                    // Update stok lama
                    await Stok.update(
                        { stok, harga, harga_beli: hargaBeli },
                        { where: { id_stok: stokMap[satuan].id } }
                    );
                } else {
                    // Buat stok baru
                    const id_stok = await generateStokId();
                    await Stok.create({
                        id_stok,
                        id_product_stok: req.params.id,
                        satuan,
                        stok,
                        harga,
                        harga_beli: hargaBeli
                    });
                }
            }

            // 🔁 Ambil data produk terbaru + stok lengkap
            const updatedProduct = await Product.findOne({
                where: { id_product: req.params.id },
                include: [
                    {
                        model: Stok,
                        as: "stok",
                        attributes: [
                            "id_stok",
                            "satuan",
                            "stok",
                            "harga",
                            "id_product_shopee",
                            "id_product_lazada",
                            "harga_beli"
                        ]
                    }
                ]
            });

            // 📤 Response ke Flutter
            return res.status(200).json({
                idProduct: updatedProduct.id_product,
                productKategori: updatedProduct.product_kategori,
                namaProduct: updatedProduct.nama_product,
                gambarProduct: imageUrl,
                deskripsiProduct: updatedProduct.deskripsi_product,
                stokList: updatedProduct.stok.map(item => ({
                    idStok: item.id_stok,
                    satuan: item.satuan,
                    jumlah: item.stok,
                    harga: item.harga,
                    idProductShopee: item.id_product_shopee,
                    idProductLazada: item.id_product_lazada,
                    hargaBeli: item.harga_beli
                })),
                kategori: kategori.nama_kategori
            });

        } catch (error) {
            console.error("❌ Error saat update produk:", error);
            return res.status(500).json({ message: "Terjadi kesalahan server", error: error.message });
        }
    },

    deleteProduct: async (req, res) => {
        try {
            const { id } = req.params;

            const product = await Product.findByPk(id);
            if (!product)
                return res.status(404).json({ message: "Product not found" });

            // ✅ Soft delete — ubah aktif menjadi false
            await product.update({ aktif: false });

            res.json({ message: "Product deactivated successfully" });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    getAllKategori: async (req, res) => {
        try {
            const kategori = await Kategori.findAll();
            res.json(kategori);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    addKategori: async (req, res) => {
        try {
            const { nama_kategori } = req.body;

            if (!nama_kategori || nama_kategori.trim() === "") {
                return res.status(400).json({ message: "Nama kategori tidak boleh kosong." });
            }

            // Cek apakah sudah ada dengan nama sama
            const existing = await Kategori.findOne({ where: { nama_kategori } });
            if (existing) {
                return res.status(400).json({ message: "Kategori dengan nama ini sudah ada." });
            }

            const newId = await generateKategoriId();

            const newKategori = await Kategori.create({
                id_kategori: newId,
                nama_kategori,
            });

            return res.status(201).json({
                message: "Kategori berhasil ditambahkan",
                data: newKategori
            });
        } catch (error) {
            console.error("❌ Gagal menambah kategori:", error);
            return res.status(500).json({ message: "Gagal menambah kategori", error: error.message });
        }
    },

    updateKategori: async (req, res) => {
        try {
            const { id } = req.params;
            const { nama_kategori } = req.body;

            // Validasi input
            if (!nama_kategori || nama_kategori.trim() === "") {
                return res.status(400).json({ message: "Nama kategori tidak boleh kosong." });
            }

            // Cek apakah kategori ada
            const existingKategori = await Kategori.findByPk(id);
            if (!existingKategori) {
                return res.status(404).json({ message: "Kategori tidak ditemukan." });
            }

            // Cek apakah ada kategori lain dengan nama yang sama
            const duplicate = await Kategori.findOne({
                where: {
                    nama_kategori,
                    id_kategori: { [Op.ne]: id }
                }
            });
            if (duplicate) {
                return res.status(400).json({ message: "Nama kategori sudah digunakan oleh kategori lain." });
            }

            // Update kategori
            await Kategori.update(
                { nama_kategori },
                { where: { id_kategori: id } }
            );

            // Ambil data terbaru
            const updated = await Kategori.findByPk(id);

            return res.status(200).json({
                message: "Kategori berhasil diperbarui",
                data: updated
            });
        } catch (error) {
            console.error("❌ Gagal update kategori:", error);
            return res.status(500).json({
                message: "Gagal memperbarui kategori",
                error: error.message
            });
        }
    },

    getAllStok: async (req, res) => {
        try {
            const stokList = await Stok.findAll({
                where: { aktif: true }, // ✅ hanya stok aktif
            });
            res.json(stokList);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    getStokById: async (req, res) => {
        try {
            const stok = await Stok.findOne({
                where: {
                    id_stok: req.params.id,
                    aktif: true, // ✅ hanya ambil stok yang masih aktif
                },
            });

            if (!stok)
                return res.status(404).json({ message: "Stok tidak ditemukan atau nonaktif" });

            res.json(stok);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    updateStok: async (req, res) => {
        try {
            const { satuan, stok } = req.body;
            const updatedStok = await Stok.update({ satuan, stok }, {
                where: { id_stok: req.params.id },
            });
            res.json({ message: "Stok berhasil diperbarui" });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    deleteStok: async (req, res) => {
        try {
            const { id } = req.params;
            const stok = await Stok.findByPk(id);

            if (!stok) {
                return res.status(404).json({ message: "Stok tidak ditemukan" });
            }

            // Ubah status aktif jadi false
            stok.aktif = false;
            await stok.save();

            res.json({ message: "Stok berhasil dinonaktifkan (aktif = false)" });
        } catch (error) {
            console.error("❌ Error deleteStok:", error);
            res.status(500).json({ message: error.message });
        }
    },

    getSatuanByProductId: async (req, res) => {
        try {
            const { id } = req.params;

            // Ambil stok yang aktif = true untuk produk tertentu
            const stokList = await Stok.findAll({
                where: {
                    id_product_stok: id,
                    aktif: true, // ✅ hanya stok aktif
                },
            });

            if (!stokList || stokList.length === 0) {
                return res.status(404).json({
                    message: "Tidak ada satuan aktif untuk produk ini",
                });
            }

            const satuanList = stokList.map((s) => ({
                id_stok: s.id_stok,
                satuan: s.satuan,
                jumlah: s.stok,
                harga: s.harga,
                hargaBeli: s.harga_beli,
                aktif: s.aktif, // boleh ikut ditampilkan agar frontend tahu statusnya
            }));

            res.status(200).json(satuanList);
        } catch (error) {
            console.error("Error mengambil satuan:", error);
            res.status(500).json({
                message: "Gagal mengambil satuan",
                error: error.message,
            });
        }
    },

    getProductByName: async (req, res) => {
        try {
            const { name } = req.params;

            const products = await Product.findAll({
                where: {
                    nama_product: {
                        [Op.like]: `%${name}%`  // pencarian sebagian
                    }
                },
                include: [
                    {
                        model: Stok,
                        as: "stok",
                        required: false,
                    }
                ]
            });

            const result = products.map(product => ({
                id_product: product.id_product,
                nama_product: product.nama_product,
                deskripsi_product: product.deskripsi_product,
                gambar_product: product.gambar_product
                    ? `data:image/png;base64,${product.gambar_product.toString("base64")}`
                    : null,
                stok: product.stok?.map((item) => ({
                    satuan: item.satuan,
                    harga: item.harga,
                    hargaBeli: item.harga_beli,
                    jumlah: item.stok
                })) || []
            }));

            res.json(result);
        } catch (error) {
            console.error("❌ Error saat mencari produk:", error);
            res.status(500).json({ message: "Gagal mencari produk", error: error.message });
        }
    },

    konversiStok: async (req, res) => {
        try {
            const { id_product, dari_satuan, jumlah_dari, ke_satuan, jumlah_ke } = req.body;

            if (!id_product || !dari_satuan || !ke_satuan || !jumlah_dari || !jumlah_ke) {
                return res.status(400).json({ message: "Semua field wajib diisi" });
            }

            const productExists = await Product.findByPk(id_product);
            if (!productExists) {
                return res.status(404).json({ message: "Product not found" });
            }

            const stokDari = await Stok.findOne({
                where: { id_product_stok: id_product, satuan: dari_satuan }
            });

            if (!stokDari) {
                return res.status(404).json({ message: `Satuan ${dari_satuan} tidak ditemukan untuk produk ini` });
            }

            if (stokDari.stok < jumlah_dari) {
                return res.status(400).json({ message: `Stok ${dari_satuan} tidak mencukupi` });
            }
            const stokKe = await Stok.findOne({
                where: { id_product_stok: id_product, satuan: ke_satuan }
            });

            if (!stokKe) {
                return res.status(404).json({ message: `Satuan ${ke_satuan} tidak ditemukan untuk produk ini` });
            }

            stokDari.stok -= jumlah_dari;
            stokKe.stok += jumlah_ke;

            await stokDari.save();
            await stokKe.save();

            const updatedStok = await Stok.findAll({
                where: { id_product_stok: id_product }
            });

            return res.json({
                message: "Konversi stok berhasil",
                stok: updatedStok.map(item => ({
                    satuan: item.satuan,
                    stok: item.stok,
                    harga: item.harga
                }))
            });
        } catch (error) {
            console.error("❌ Error konversi stok:", error);
            res.status(500).json({ message: "Gagal melakukan konversi stok", error: error.message });
        }
    },

    getLatestProduct: async (req, res) => {
        try {
            // Ambil ID dari path param atau query param
            const productId = req.params.productId || req.query.id_product;

            let productQuery;

            if (productId) {
                // Ambil produk sesuai ID
                productQuery = await Product.findOne({
                    where: { id_product: productId },
                    include: [{ model: Stok, as: "stok" }]
                });
            } else {
                // Ambil produk terbaru
                productQuery = await Product.findOne({
                    order: [['id_product', 'DESC']],
                    include: [{ model: Stok, as: "stok" }]
                });
            }

            if (!productQuery) {
                return res.status(404).json({
                    success: false,
                    message: productId
                        ? `Produk dengan id ${productId} tidak ditemukan`
                        : "Belum ada produk di database"
                });
            }

            const imageUrl = productQuery.gambar_product
                ? `data:image/png;base64,${productQuery.gambar_product.toString('base64')}`
                : null;

            const isShopeeExists = productQuery.stok.some(
                (s) => s.id_product_shopee !== null
            );

            return res.status(200).json({
                success: true,
                message: productId
                    ? `Produk dengan id ${productId} berhasil diambil`
                    : "Produk terbaru berhasil diambil",
                data: {
                    id_product: productQuery.id_product,
                    nama_product: productQuery.nama_product,
                    product_kategori: productQuery.product_kategori,
                    gambar_product: imageUrl,
                    deskripsi_product: productQuery.deskripsi_product || "",
                    is_shopee_exists: isShopeeExists,
                    stok: productQuery.stok.map((s) => ({
                        id_stok: s.id_stok,
                        satuan: s.satuan,
                        harga: s.harga,
                        hargaBeli: s.harga_beli,
                        stokQty: s.stok,
                        id_product_shopee: s.id_product_shopee
                    }))
                }
            });
        } catch (error) {
            console.error("❌ Error getLatestProduct:", error);
            return res.status(500).json({
                success: false,
                message: "Terjadi kesalahan server",
                error: error.message
            });
        }
    },

    getAllProductWithStok: async (req, res) => {
        try {
            const products = await Product.findAll({
                where: { aktif: true }, // ✅ hanya ambil produk aktif
                include: [
                    {
                        model: Stok,
                        as: "stok",
                        attributes: ["id_stok", "satuan", "harga", "stok"],
                        where: { aktif: true }, // ✅ hanya ambil stok aktif
                        required: false, // biar produk tetap muncul walau stok kosong
                    },
                    {
                        model: Kategori,
                        as: "kategori",
                        attributes: ["nama_kategori"],
                    },
                ],
                order: [["nama_product", "ASC"]],
            });

            if (!products || products.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Belum ada data produk di database",
                });
            }

            const result = products.map((p) => ({
                id_product: p.id_product,
                nama_product: p.nama_product,
                deskripsi_product: p.deskripsi_product,
                product_kategori: p.kategori ? p.kategori.nama_kategori : "-",
                gambar_product_url: p.gambar_product
                    ? `/api/product/loadImage/${p.id_product}`
                    : null,

                stok_list: (p.stok || []).map((s) => ({
                    id_stok: s.id_stok,
                    satuan: s.satuan,
                    harga: s.harga,
                    hargaBeli: s.harga_beli,
                    stok: s.stok,
                })),
            }));

            return res.status(200).json({
                success: true,
                count: result.length,
                data: result,
            });
        } catch (error) {
            console.error("❌ Error getAllProductWithStok:", error);
            return res.status(500).json({
                success: false,
                message: "Terjadi kesalahan pada server",
                error: error.message,
            });
        }
    },

    loadProductImage: async (req, res) => {
        try {
            const { id } = req.params;

            const product = await Product.findByPk(id);

            if (!product || !product.gambar_product) {
                return res.status(404).send("Image not found");
            }

            // Kirim gambar langsung, bukan base64
            res.setHeader("Content-Type", "image/jpeg"); // sesuaikan tipe gambar
            return res.send(product.gambar_product);
        } catch (err) {
            console.error("❌ Error loadProductImage:", err);
            return res.status(500).send("Server error");
        }
    },
};

module.exports = ProductController;

