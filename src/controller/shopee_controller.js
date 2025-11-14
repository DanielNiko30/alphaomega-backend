const crypto = require("crypto");
const https = require("https");
const FormData = require("form-data");
const axios = require("axios");
const { QueryTypes } = require("sequelize");
const { Product } = require("../model/product_model");
const { Stok } = require("../model/stok_model");
const { Shopee } = require("../model/shopee_model");
const { getDB } = require("../config/sequelize");
const { HTransJual } = require("../model/htrans_jual_model");
const { DTransJual } = require("../model/dtrans_jual_model");
const { Op } = require("sequelize");
const fs = require("fs");
const path = require("path");

const db = getDB();

const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
let PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;
if (PARTNER_KEY) PARTNER_KEY = PARTNER_KEY.trim();

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

function postJSON(url, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const parsedUrl = new URL(url);

        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(data),
            },
        };

        const req = https.request(options, (res) => {
            let chunks = "";
            res.on("data", (chunk) => (chunks += chunk));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(chunks));
                } catch (err) {
                    reject(new Error(`Invalid JSON response: ${chunks}`));
                }
            });
        });

        req.on("error", (err) => reject(err));
        req.write(data);
        req.end();
    });
}

function getJSON(url) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);

        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method: "GET",
        };

        const req = https.request(options, (res) => {
            let chunks = "";
            res.on("data", (chunk) => (chunks += chunk));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(chunks));
                } catch (err) {
                    reject(new Error(`Invalid JSON response: ${chunks}`));
                }
            });
        });

        req.on("error", (err) => reject(err));
        req.end();
    });
}

function generateSign(path, timestamp, access_token, shop_id) {
    const baseString = `${PARTNER_ID}${path}${timestamp}${access_token}${shop_id}`;
    return crypto.createHmac("sha256", PARTNER_KEY).update(baseString).digest("hex");
}

const shopeeCallback = async (req, res) => {
    try {
        const { code, shop_id, state } = req.query;

        if (!code || !shop_id) {
            return res.status(400).json({ error: "Missing code or shop_id" });
        }

        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/auth/token/get";

        // BaseString hanya partner_id + path + timestamp
        const baseString = `${PARTNER_ID}${path}${timestamp}`;
        const sign = crypto
            .createHmac("sha256", PARTNER_KEY)
            .update(baseString)
            .digest("hex");

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;
        const body = { code, shop_id, partner_id: PARTNER_ID };

        console.log("REQUEST TO SHOPEE:", { url, body });

        const shopeeResponse = await postJSON(url, body);

        // Simpan token ke database
        if (shopeeResponse.access_token && shopeeResponse.refresh_token) {
            await Shopee.destroy({ where: {} }); // hapus semua token lama
            await Shopee.create({
                shop_id: shop_id,
                access_token: shopeeResponse.access_token,
                refresh_token: shopeeResponse.refresh_token,
                expire_in: shopeeResponse.expire_in,
                last_updated: timestamp,
            });

            console.log(`✅ Shopee token replaced for shop_id ${shop_id}`);
        } else {
            console.error("❌ Shopee did not return token:", shopeeResponse);
        }

        return res.json({
            success: true,
            shop_id,
            state,
            data: {
                partner_id: PARTNER_ID,
                timestamp,
                baseString,
                generatedSign: sign,
                url,
                shopee_response: shopeeResponse,
            },
        });
    } catch (err) {
        console.error("Shopee Callback Error:", err);
        return res.status(500).json({ error: err.message });
    }
};

const getShopeeItemList = async (req, res) => {
    try {
        const shopeeData = await Shopee.findOne();
        if (!shopeeData || !shopeeData.access_token) {
            return res.status(400).json({ error: "Shopee token not found. Please authorize first." });
        }

        const { shop_id, access_token } = shopeeData;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/product/get_item_list";

        const sign = generateSign(path, timestamp, access_token, shop_id);

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}&offset=0&page_size=10&item_status=NORMAL`;

        console.log("Shopee Get Item List URL:", url);

        const response = await getJSON(url);

        return res.json({
            success: true,
            timestamp,
            shop_id,
            url,
            shopee_response: response,
        });
    } catch (err) {
        console.error("Shopee Get Item List Error:", err);
        return res.status(500).json({ error: err.message });
    }
};

const createProductShopee = async (req, res) => {
    try {
        const { id_product } = req.params;
        const { weight, category_id, dimension, condition, item_sku, brand_id, brand_name, selected_unit, logistic_id } = req.body;

        // 1️⃣ Ambil token Shopee
        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token) {
            console.log("❌ Shopee token not found");
            return res.status(400).json({ error: "Shopee token not found. Please authorize first." });
        }
        const { shop_id, access_token } = shopeeData;

        // 2️⃣ Ambil data produk + stok
        const product = await Product.findOne({
            where: { id_product },
            include: [{ model: Stok, as: "stok" }],
        });
        if (!product) {
            console.log("❌ Produk tidak ditemukan:", id_product);
            return res.status(404).json({ error: "Produk tidak ditemukan" });
        }
        if (!product.gambar_product) {
            console.log("❌ Produk tidak memiliki gambar!");
            return res.status(400).json({ error: "Produk tidak memiliki gambar!" });
        }

        // 3️⃣ Pilih stok sesuai satuan
        const stokTerpilih = selected_unit
            ? product.stok.find(s => s.satuan === selected_unit)
            : product.stok[0];
        if (!stokTerpilih) {
            console.log("❌ Stok untuk satuan tidak ditemukan:", selected_unit);
            return res.status(400).json({ error: `Stok untuk satuan ${selected_unit} tidak ditemukan` });
        }

        // 4️⃣ Upload gambar
        const timestamp = Math.floor(Date.now() / 1000);
        const uploadPath = "/api/v2/media_space/upload_image";
        const uploadSign = generateSign(uploadPath, timestamp, access_token, shop_id);
        const uploadUrl = `https://partner.shopeemobile.com${uploadPath}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${uploadSign}`;
        const imageBuffer = Buffer.isBuffer(product.gambar_product) ? product.gambar_product : Buffer.from(product.gambar_product);

        const formData = new FormData();
        formData.append("image", imageBuffer, { filename: `${product.id_product}.png`, contentType: "image/png" });

        let uploadResponse;
        try {
            uploadResponse = await axios.post(uploadUrl, formData, { headers: formData.getHeaders() });
        } catch (err) {
            console.error("❌ Upload image error:", err.response?.data || err.message);
            return res.status(400).json({
                error: "Gagal upload gambar ke Shopee",
                detail: err.response?.data || err.message
            });
        }

        const uploadedImageId = uploadResponse.data?.response?.image_info?.image_id;
        if (!uploadedImageId) {
            console.error("❌ No image_id in upload response:", uploadResponse.data);
            return res.status(400).json({ error: "Gagal mendapatkan image_id dari Shopee", shopee_response: uploadResponse.data });
        }

        // 5️⃣ Body Add Item dengan logistic_id dari request
        if (!logistic_id) {
            console.log("❌ logistic_id wajib diisi");
            return res.status(400).json({ error: "logistic_id wajib diisi" });
        }

        const body = {
            original_price: Number(stokTerpilih.harga),
            description: product.deskripsi_product || "Deskripsi tidak tersedia",
            item_name: product.nama_product,
            item_sku: item_sku || null,
            weight: Number(weight),
            package_height: Number(dimension.height),
            package_length: Number(dimension.length),
            package_width: Number(dimension.width),
            logistic_info: [
                {
                    logistic_id: Number(logistic_id), // dari request
                    enabled: true,
                    is_free: false
                }
            ],
            category_id: Number(category_id),
            seller_stock: [
                {
                    stock_location_id: 0,
                    stock: Number(stokTerpilih.stok)
                }
            ],
            condition: condition || "NEW",
            image: { image_id_list: [uploadedImageId], image_ratio: "1:1" },
            brand: { brand_id: Number(brand_id) || 0, original_brand_name: brand_name || "No Brand" }
        };

        // -----------------------
        // TAMBAHKAN SHELF LIFE (HARDCODE) — agar tidak error
        // default = 12 Months (value_id: 593)
        // jangan ubah URL/sign; hanya menambah atribut
        // -----------------------
        body.attributes = [
            // format ini aman: kirim attribute_id + value_list dengan original_value_name
            {
                attribute_id: 100010, // Shelf Life
                value_list: [
                    {
                        value_id: 593, // 12 Months
                        original_value_name: "12 Months"
                    }
                ]
            }
        ];

        console.log("📤 Sending add_item with attributes:", body.attributes);

        const addItemPath = "/api/v2/product/add_item";
        const addItemSign = generateSign(addItemPath, timestamp, access_token, shop_id);
        const addItemUrl = `https://partner.shopeemobile.com${addItemPath}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${addItemSign}`;

        let createResponse;
        try {
            createResponse = await axios.post(addItemUrl, body, { headers: { "Content-Type": "application/json" } });
        } catch (err) {
            console.error("❌ Shopee add_item request failed:", err.response?.data || err.message);
            // kembalikan kemungkinan error lengkap ke client
            return res.status(err.response?.status || 500).json({
                success: false,
                message: err.response?.data?.message || "Request to Shopee failed",
                shopee_response: err.response?.data || err.message
            });
        }

        if (createResponse.data.error) {
            console.error("❌ Shopee response error:", createResponse.data);
            return res.status(400).json({ success: false, message: createResponse.data.message, shopee_response: createResponse.data });
        }

        // ✅ Simpan id_product_shopee di tabel Stok sesuai satuan
        const newShopeeId = createResponse.data.response?.item_id;
        if (newShopeeId) {
            try {
                await Stok.update(
                    { id_product_shopee: newShopeeId },
                    { where: { id_stok: stokTerpilih.id_stok } }
                );
            } catch (dbErr) {
                console.error("⚠️ Gagal update id_product_shopee ke DB:", dbErr.message || dbErr);
                // tetap lanjutkan sukses response, tapi sertakan peringatan
                return res.status(201).json({
                    success: true,
                    message: "Produk ditambahkan ke Shopee tapi gagal menyimpan id ke DB",
                    shopee_response: createResponse.data,
                    db_error: dbErr.message || dbErr,
                    updated_stock: {
                        id_stok: stokTerpilih.id_stok,
                        satuan: stokTerpilih.satuan,
                        id_product_shopee: newShopeeId
                    }
                });
            }
        }

        return res.status(201).json({
            success: true,
            message: "Produk berhasil ditambahkan ke Shopee",
            shopee_response: createResponse.data,
            updated_stock: {
                id_stok: stokTerpilih.id_stok,
                satuan: stokTerpilih.satuan,
                id_product_shopee: newShopeeId
            }
        });

    } catch (err) {
        console.error("❌ Shopee Create Product Error (fatal):", err.response?.data || err.message);
        return res.status(500).json({ error: err.response?.data || err.message, message: "Gagal menambahkan produk ke Shopee." });
    }
};

const getShopeeCategories = async (req, res) => {
    try {
        const shopeeData = await Shopee.findOne();
        if (!shopeeData || !shopeeData.access_token) {
            return res.status(400).json({ error: "Shopee token not found. Please authorize first." });
        }

        const { shop_id, access_token } = shopeeData;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/product/get_category";

        const sign = generateSign(path, timestamp, access_token, shop_id);

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}`;

        console.log("Shopee Get Category URL:", url);

        const response = await getJSON(url);

        if (response.error) {
            return res.status(400).json({
                success: false,
                message: response.message || "Gagal mengambil kategori Shopee",
                shopee_response: response
            });
        }

        return res.json({
            success: true,
            data: response.response?.category_list || [],
        });
    } catch (err) {
        console.error("Shopee Get Category Error:", err);
        return res.status(500).json({ error: err.message });
    }
};

const getShopeeLogistics = async (req, res) => {
    try {
        const shopeeData = await Shopee.findOne();
        if (!shopeeData || !shopeeData.access_token) {
            console.log("❌ Shopee token tidak ditemukan");
            return res.status(400).json({ error: "Shopee token not found. Please authorize first." });
        }

        const { shop_id, access_token } = shopeeData;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/logistics/get_channel_list";
        const sign = generateSign(path, timestamp, access_token, shop_id);
        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}`;

        console.log("🔹 Shopee Get Logistic URL:", url);

        const response = await getJSON(url);

        if (response.error) {
            console.error("❌ Shopee API Error:", response);
            return res.status(400).json({
                success: false,
                message: response.message || "Gagal mengambil logistic Shopee",
                shopee_response: response
            });
        }

        const allChannels = response.response?.logistics_channel_list || [];

        // Debug: tampilkan detail semua channel supaya bisa ambil ID
        const channelDetails = allChannels.map((ch) => ({
            id: ch.logistics_channel_id,
            name: ch.logistics_channel_name,
            enabled: ch.enabled,
            cod_enabled: ch.cod_enabled,
            fee_type: ch.fee_type,
            seller_logistic_has_configuration: ch.seller_logistic_has_configuration,
            force_enable: ch.force_enable,
            mask_channel_id: ch.mask_channel_id,
        }));

        console.log("🔹 Semua channel detail:", JSON.stringify(channelDetails, null, 2));

        return res.json({
            success: true,
            total_channels: allChannels.length,
            channels: channelDetails,
        });

    } catch (err) {
        console.error("❌ Shopee Get Logistic Error:", err);
        return res.status(500).json({ error: err.message });
    }
};

const getBrandListShopee = async (req, res) => {
    try {
        const { category_id, status = 1, offset = 0, page_size = 10, language = "en" } = req.body;

        if (!category_id) return res.status(400).json({ error: "category_id is required" });

        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token) return res.status(400).json({ error: "Shopee token not found. Please authorize first." });

        const { shop_id, access_token } = shopeeData;

        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/product/brand/get_brand_list";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}`;

        const bodyShopee = {
            category_id: Number(category_id),
            status: Number(status),
            offset: Number(offset),
            page_size: Number(page_size),
            language: language
        };

        console.log("🔹 Shopee Request URL:", url);
        console.log("🔹 Shopee Request Body:", JSON.stringify(bodyShopee, null, 2));

        // 3️⃣ Request ke Shopee
        const response = await axios.post(url, bodyShopee, {
            headers: { "Content-Type": "application/json" },
            validateStatus: () => true // supaya axios tidak throw error untuk status 4xx/5xx
        });

        console.log("🔹 Shopee Response Status:", response.status);
        console.log("🔹 Shopee Response Data:", JSON.stringify(response.data, null, 2));
        console.log("🔹 Shopee Response Headers:", JSON.stringify(response.headers, null, 2));

        // Tangani error_not_found
        if (response.data.error === "error_not_found") {
            return res.status(200).json({
                success: true,
                message: "Kategori valid tapi belum ada brand",
                shopee_response: { brands: [] }
            });
        }

        if (response.data.error) {
            return res.status(400).json({
                success: false,
                message: response.data.message,
                shopee_response: response.data
            });
        }

        return res.status(200).json({
            success: true,
            message: "Brand list retrieved successfully",
            shopee_response: response.data
        });

    } catch (err) {
        console.error("❌ Shopee Get Brand List Error:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mendapatkan brand dari Shopee",
            error: err.response?.data || err.message
        });
    }
};

const updateProductShopee = async (req, res) => {
    try {
        const { id_product } = req.params;
        const { weight, category_id, dimension, condition, item_sku, brand_id, brand_name, selected_unit, logistic_id } = req.body;

        // 1️⃣ Ambil token Shopee
        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token) {
            return res.status(400).json({ error: "Shopee token not found. Please authorize first." });
        }
        const { shop_id, access_token } = shopeeData;

        // 2️⃣ Ambil data produk + stok
        const product = await Product.findOne({
            where: { id_product },
            include: [{ model: Stok, as: "stok" }],
        });

        if (!product) return res.status(404).json({ error: "Produk tidak ditemukan" });

        // 3️⃣ Pilih stok sesuai satuan
        const stokTerpilih = selected_unit
            ? product.stok.find(s => s.satuan === selected_unit)
            : product.stok[0];

        if (!stokTerpilih) return res.status(400).json({ error: `Stok untuk satuan ${selected_unit} tidak ditemukan` });

        if (!stokTerpilih.id_product_shopee) {
            return res.status(400).json({ error: "Produk ini belum memiliki id_product_shopee, silakan add_item terlebih dahulu." });
        }

        // 4️⃣ Upload gambar (optional: jika user ingin ganti gambar baru)
        let uploadedImageId = null;
        if (product.gambar_product) {
            const timestamp = Math.floor(Date.now() / 1000);
            const uploadPath = "/api/v2/media_space/upload_image";
            const uploadSign = generateSign(uploadPath, timestamp, access_token, shop_id);
            const uploadUrl = `https://partner.shopeemobile.com${uploadPath}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${uploadSign}`;

            const imageBuffer = Buffer.isBuffer(product.gambar_product) ? product.gambar_product : Buffer.from(product.gambar_product);
            const formData = new FormData();
            formData.append("image", imageBuffer, {
                filename: `${product.id_product}.png`,
                contentType: "image/png"
            });

            const uploadResponse = await axios.post(uploadUrl, formData, { headers: formData.getHeaders() });
            uploadedImageId = uploadResponse.data?.response?.image_info?.image_id || null;

            if (!uploadedImageId) {
                return res.status(400).json({ error: "Gagal upload image ke Shopee", shopee_response: uploadResponse.data });
            }
        }

        // 5️⃣ Body Update Item
        if (!logistic_id) return res.status(400).json({ error: "logistic_id wajib diisi" });

        const body = {
            item_id: Number(stokTerpilih.id_product_shopee), // ID produk di Shopee
            original_price: Number(stokTerpilih.harga),
            description: product.deskripsi_product || "Deskripsi tidak tersedia",
            item_name: product.nama_product,
            item_sku: item_sku || null,
            weight: Number(weight),
            package_height: Number(dimension.height),
            package_length: Number(dimension.length),
            package_width: Number(dimension.width),
            logistic_info: [
                {
                    logistic_id: Number(logistic_id), // mask_channel_id diambil dari frontend
                    enabled: true,
                    is_free: false
                }
            ],
            category_id: Number(category_id),
            seller_stock: [
                {
                    stock_location_id: 0,
                    stock: Number(stokTerpilih.stok)
                }
            ],
            condition: condition || "NEW",
            brand: { brand_id: Number(brand_id) || 0, original_brand_name: brand_name || "No Brand" }
        };

        // Tambahkan gambar jika ada perubahan
        if (uploadedImageId) {
            body.image = { image_id_list: [uploadedImageId], image_ratio: "1:1" };
        }

        // 6️⃣ Request ke Shopee Update API
        const timestamp = Math.floor(Date.now() / 1000);
        const updatePath = "/api/v2/product/update_item";
        const updateSign = generateSign(updatePath, timestamp, access_token, shop_id);
        const updateUrl = `https://partner.shopeemobile.com${updatePath}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${updateSign}`;

        const updateResponse = await axios.post(updateUrl, body, {
            headers: { "Content-Type": "application/json" }
        });

        if (updateResponse.data.error) {
            return res.status(400).json({
                success: false,
                message: updateResponse.data.message,
                shopee_response: updateResponse.data
            });
        }

        return res.status(200).json({
            success: true,
            message: "Produk berhasil diupdate di Shopee",
            shopee_response: updateResponse.data,
            updated_stock: {
                id_stok: stokTerpilih.id_stok,
                satuan: stokTerpilih.satuan,
                id_product_shopee: stokTerpilih.id_product_shopee
            }
        });

    } catch (err) {
        console.error("❌ Shopee Update Product Error:", err.response?.data || err.message);
        return res.status(500).json({ error: err.response?.data || err.message, message: "Gagal update produk di Shopee." });
    }
};

const getShopeeItemInfo = async (req, res) => {
    try {
        const { id_product } = req.params;
        const { satuan } = req.body; // satuan wajib dikirim di body

        // 1️⃣ Validasi satuan wajib
        if (!satuan) {
            return res.status(400).json({
                success: false,
                message: "Field 'satuan' wajib dikirim di body request",
            });
        }

        // 2️⃣ Ambil data Shopee (token & shop_id)
        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token) {
            return res.status(400).json({
                success: false,
                message: "Shopee token tidak ditemukan. Harap authorize ulang.",
            });
        }
        const { shop_id, access_token } = shopeeData;

        // 3️⃣ Ambil data produk + stok sesuai satuan
        const product = await Product.findOne({
            where: { id_product },
            include: [{ model: Stok, as: "stok" }],
        });

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Produk tidak ditemukan di database lokal",
            });
        }

        const stokTerpilih = product.stok.find((s) => s.satuan === satuan);

        if (!stokTerpilih) {
            return res.status(404).json({
                success: false,
                message: `Stok dengan satuan '${satuan}' tidak ditemukan untuk produk ini`,
            });
        }

        if (!stokTerpilih.id_product_shopee) {
            return res.status(400).json({
                success: false,
                message: `Produk dengan satuan '${satuan}' belum memiliki id_product_shopee. Tidak dapat mengambil data Shopee.`,
            });
        }

        const item_id = stokTerpilih.id_product_shopee;

        // 4️⃣ Buat signature untuk request Shopee
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/product/get_item_base_info";

        const sign = generateSign(path, timestamp, access_token, shop_id);

        const url = `https://partner.shopeemobile.com${path}?partner_id=${process.env.SHOPEE_PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}&item_id_list=${item_id}&need_tax_info=false&need_complaint_policy=false`;

        console.log("🔹 Shopee Get Item Info URL:", url);

        // 5️⃣ Request ke Shopee
        const response = await axios.get(url, {
            headers: { "Content-Type": "application/json" },
        });

        if (response.data.error) {
            return res.status(400).json({
                success: false,
                message: response.data.message,
                shopee_response: response.data,
            });
        }

        const item = response.data.response?.item_list?.[0];
        if (!item) {
            return res.status(404).json({
                success: false,
                message: "Data produk Shopee tidak ditemukan",
                shopee_response: response.data,
            });
        }

        // 6️⃣ Ambil field yang dibutuhkan untuk frontend
        const result = {
            item_id: item.item_id,
            weight: item.weight,
            category_id: item.category_id,
            length: item.package_length,
            width: item.package_width,
            height: item.package_height,
            condition: item.condition,
            item_sku: item.item_sku,
            brand_name: item.brand?.original_brand_name || "No Brand",
        };

        return res.json({
            success: true,
            data: result,
            raw_response: response.data,
        });
    } catch (err) {
        console.error("❌ Shopee Get Item Info Error:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil informasi produk dari Shopee",
            error: err.response?.data || err.message,
        });
    }
};

const getShopeeOrders = async (req, res) => {
    try {
        const {
            time_range_field = "create_time",
            page_size = 20,
            cursor = "",
            order_status = "READY_TO_SHIP"
        } = req.query;

        // Hitung timestamp hari ini (awal dan akhir)
        const now = new Date();
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 hari sebelumnya

        const time_from = Math.floor(oneWeekAgo.getTime() / 1000);
        const time_to = Math.floor(now.getTime() / 1000);

        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token) {
            return res.status(400).json({ error: "Shopee token not found. Please authorize first." });
        }

        const { shop_id, access_token } = shopeeData;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/order/get_order_list";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        const params = new URLSearchParams({
            partner_id: PARTNER_ID,
            timestamp,
            access_token,
            shop_id,
            sign,
            time_range_field: "create_time",
            time_from,
            time_to,
            page_size,
            cursor,
            order_status
        }).toString();

        const url = `https://partner.shopeemobile.com${path}?${params}`;

        const response = await axios.get(url, { headers: { "Content-Type": "application/json" } });

        if (response.data.error) {
            return res.status(400).json({ success: false, message: response.data.message, shopee_response: response.data });
        }

        return res.json({ success: true, data: response.data.response });

    } catch (err) {
        console.error("❌ Shopee Get Orders Error:", err.response?.data || err.message);
        return res.status(500).json({ success: false, message: "Gagal mengambil pesanan Shopee", error: err.response?.data || err.message });
    }
};

const getShopeeShippedOrders = async (req, res) => {
    try {
        // Hitung timestamp untuk kemarin + hari ini
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);

        const time_from = Math.floor(yesterday.setHours(0, 0, 0, 0) / 1000);
        const time_to = Math.floor(today.setHours(23, 59, 59, 999) / 1000);

        // Ambil token Shopee
        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token || !shopeeData?.shop_id) {
            return res.status(400).json({
                success: false,
                message: "Shopee token atau shop_id tidak ditemukan di database",
            });
        }

        const { shop_id, access_token } = shopeeData;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/order/get_order_list";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        const params = new URLSearchParams({
            partner_id: PARTNER_ID,
            timestamp,
            access_token,
            shop_id,
            sign,
            time_range_field: "create_time",
            time_from,
            time_to,
            page_size: 50,
            cursor: 0,
            order_status: "PROCESSED", // hanya shipped
        }).toString();

        const url = `https://partner.shopeemobile.com${path}?${params}`;
        const response = await axios.get(url, { headers: { "Content-Type": "application/json" } });

        if (response.data.error) {
            return res.status(400).json({
                success: false,
                message: response.data.message,
                shopee_response: response.data,
            });
        }

        return res.json({
            success: true,
            message: "Berhasil mengambil shipped orders Shopee",
            data: response.data.response,
        });

    } catch (err) {
        console.error("❌ Error getShopeeShippedOrders:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil shipped orders Shopee",
            error: err.response?.data || err.message,
        });
    }
};

const getOrderDetail = async (req, res) => {
    try {
        const { order_sn_list } = req.query;

        if (!order_sn_list) {
            return res.status(400).json({
                success: false,
                message: "order_sn_list wajib dikirim. Pisahkan dengan koma jika lebih dari satu",
            });
        }

        const shop = await Shopee.findOne();
        if (!shop?.access_token || !shop?.shop_id) {
            return res.status(400).json({
                success: false,
                message: "Shopee token atau shop_id tidak ditemukan di database",
            });
        }

        const { shop_id, access_token } = shop;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/order/get_order_detail";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        const BASE_URL = "https://partner.shopeemobile.com";
        const params = new URLSearchParams({
            partner_id: PARTNER_ID,
            timestamp: timestamp,
            access_token: access_token,
            shop_id: shop_id,
            sign: sign,
            order_sn_list: order_sn_list,
            response_optional_fields:
                "buyer_username,item_list,total_amount,recipient_address,package_list,pickup_done_time,booking_sn,advance_package",
        });

        const finalUrl = `${BASE_URL}${path}?${params.toString()}`;
        console.log("🔹 FINAL Shopee URL:", finalUrl);

        const response = await axios.get(finalUrl, {
            headers: { "Content-Type": "application/json" },
            validateStatus: () => true,
        });

        if (response.data.error) {
            return res.status(400).json({
                success: false,
                message: response.data.message || "Shopee API Error",
                shopee_response: response.data,
            });
        }

        const orderDetail = response.data.response;
        const orderList = orderDetail?.order_list || [];
        const combinedOrders = [];

        for (const order of orderList) {
            const items = [];

            for (const item of order.item_list || []) {
                const stok = await db.query(
                    `
          SELECT 
            s.id_product_stok,
            s.id_product_shopee,
            s.satuan,
            p.nama_product,
            p.gambar_product
          FROM stok s
          JOIN product p ON p.id_product = s.id_product_stok
          WHERE s.id_product_shopee = :itemId
          LIMIT 1
        `,
                    {
                        replacements: { itemId: String(item.item_id) },
                        type: db.QueryTypes.SELECT,
                    }
                );

                if (stok.length > 0) {
                    const local = stok[0];
                    const gambarBase64 = local.gambar_product
                        ? `data:image/png;base64,${Buffer.from(local.gambar_product).toString("base64")}`
                        : null;

                    items.push({
                        item_id: item.item_id,
                        item_name: item.item_name,
                        variation_name: item.model_name,
                        quantity: item.model_quantity_purchased,
                        price: item.model_discounted_price,
                        from_db: true,
                        id_product_stok: local.id_product_stok,
                        satuan: local.satuan,
                        nama_product: local.nama_product,
                        gambar_product: gambarBase64,
                    });
                } else {
                    items.push({
                        item_id: item.item_id,
                        item_name: item.item_name,
                        variation_name: item.model_name,
                        quantity: item.model_quantity_purchased,
                        price: item.model_discounted_price,
                        from_db: false,
                    });
                }
            }

            // Ambil package_number, booking_sn, advance_package, dll
            const packages = (order.package_list || []).map(pkg => ({
                package_number: pkg.package_number,
                booking_sn: pkg.booking_sn || null, // ✅ Tambah booking_sn
                advance_package: pkg.advance_package || false,
                logistics_status: pkg.logistics_status,
                shipping_carrier: pkg.shipping_carrier,
                allow_self_design_awb: pkg.allow_self_design_awb,
            }));

            combinedOrders.push({
                order_sn: order.order_sn,
                buyer_username: order.buyer_username,
                total_amount: order.total_amount,
                status: order.order_status,
                pickup_done_time: order.pickup_done_time || null,
                recipient_address: order.recipient_address,
                items: items,
                packages: packages,
            });
        }

        return res.json({
            success: true,
            message: "Berhasil mengambil detail order Shopee + data lokal termasuk package_number & booking_sn",
            data: combinedOrders,
        });
    } catch (error) {
        console.error("❌ Error getOrderDetail:", error.response?.data || error.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil detail order",
            error: error.response?.data || error.message,
        });
    }
};

const searchShopeeProductByName = async (req, res) => {
    try {
        const { keyword = "", offset = 0, page_size = 50 } = req.query;

        // 1️⃣ Ambil data Shopee token
        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token) {
            return res.status(400).json({
                success: false,
                message: "Shopee token tidak ditemukan. Harap authorize ulang."
            });
        }

        const { shop_id, access_token } = shopeeData;

        // 2️⃣ Generate sign
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/product/get_item_list";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        // 3️⃣ Panggil get_item_list dengan offset & page_size
        const listUrl = `https://partner.shopeemobile.com${path}?partner_id=${process.env.SHOPEE_PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}&offset=${offset}&page_size=${page_size}&item_status=NORMAL`;

        const listResponse = await axios.get(listUrl, {
            headers: { "Content-Type": "application/json" },
        });

        const items = listResponse.data.response?.item || [];
        if (items.length === 0) {
            return res.json({
                success: true,
                message: "Tidak ada produk ditemukan di Shopee.",
                data: [],
                pagination: {
                    offset: Number(offset),
                    page_size: Number(page_size),
                    total_count: 0
                }
            });
        }

        // 4️⃣ Ambil detail produk pakai get_item_base_info (maks 50 per request)
        const detailPath = "/api/v2/product/get_item_base_info";
        const detailSign = generateSign(detailPath, timestamp, access_token, shop_id);

        const itemIds = items.map(i => i.item_id).slice(0, 50).join(",");

        const detailUrl = `https://partner.shopeemobile.com${detailPath}?partner_id=${process.env.SHOPEE_PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${detailSign}&item_id_list=${itemIds}`;

        const detailResponse = await axios.get(detailUrl, {
            headers: { "Content-Type": "application/json" },
        });

        const detailItems = detailResponse.data.response?.item_list || [];

        // 5️⃣ Filter produk berdasarkan keyword (case-insensitive)
        const filteredItems = detailItems.filter(item =>
            item.item_name?.toLowerCase().includes(keyword.toLowerCase())
        );

        return res.json({
            success: true,
            message: "Data produk berhasil diambil",
            data: filteredItems,
            pagination: {
                offset: Number(offset),
                page_size: Number(page_size),
                total_count: listResponse.data.response?.total_count || 0,
                has_next_page: listResponse.data.response?.has_next_page || false
            }
        });

    } catch (err) {
        console.error("❌ Shopee Search Item Error:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil data produk Shopee",
            error: err.response?.data || err.message,
        });
    }
};

const getShopeeOrdersWithItems = async (req, res) => {
    try {
        // Ambil token Shopee
        const shop = await Shopee.findOne();
        if (!shop?.access_token || !shop?.shop_id) {
            return res.status(400).json({
                success: false,
                message: "Shopee token atau shop_id tidak ditemukan di database",
            });
        }

        const { shop_id, access_token } = shop;

        // === Panggil API Shopee untuk semua READY_TO_SHIP ===
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/order/get_order_list";
        const sign = generateSign(path, timestamp, access_token, shop_id);
        const BASE_URL = "https://partner.shopeemobile.com";

        // Bisa set time_from ke epoch lama supaya semua order muncul
        const now = Math.floor(Date.now() / 1000);
        const twoDaysAgo = now - 2 * 24 * 60 * 60; // 2 hari ke belakang

        const params = new URLSearchParams({
            partner_id: PARTNER_ID,
            timestamp: now,
            access_token,
            shop_id,
            sign,
            order_status: "READY_TO_SHIP",
            page_size: 100,
            time_range_field: "create_time",
            time_from: twoDaysAgo,
            time_to: now,
        });

        const url = `${BASE_URL}${path}?${params.toString()}`;

        const orderListResp = await axios.get(url, {
            headers: { "Content-Type": "application/json" },
            validateStatus: () => true,
        });

        if (orderListResp.data.error) {
            return res.status(400).json({
                success: false,
                message: orderListResp.data.message || "Shopee API Error",
                shopee_response: orderListResp.data,
            });
        }

        const orderList = orderListResp.data.response?.order_list || [];
        if (orderList.length === 0) {
            return res.json({
                success: true,
                message: "Tidak ada order READY_TO_SHIP",
                data: [],
            });
        }

        const finalOrders = [];

        // Loop setiap order
        for (const order of orderList) {
            const orderSnList = [order.order_sn];
            // Ambil detail order
            const detailPath = "/api/v2/order/get_order_detail";
            const detailSign = generateSign(detailPath, timestamp, access_token, shop_id);
            const detailParams = new URLSearchParams({
                partner_id: PARTNER_ID,
                timestamp,
                access_token,
                shop_id,
                sign: detailSign,
                order_sn_list: order.order_sn,
                response_optional_fields: "buyer_username,item_list,total_amount,recipient_address,package_list",
            });
            const detailUrl = `${BASE_URL}${detailPath}?${detailParams.toString()}`;
            const orderDetailResp = await axios.get(detailUrl, { headers: { "Content-Type": "application/json" } });
            const orderDetail = orderDetailResp.data.response?.order_list?.[0];
            if (!orderDetail?.item_list) continue;

            const items = [];

            for (const item of orderDetail.item_list) {
                // Cek DB lokal
                const stok = await db.query(
                    `
                    SELECT 
                        s.id_product_stok,
                        s.id_product_shopee,
                        s.satuan,
                        p.nama_product,
                        p.gambar_product
                    FROM stok s
                    JOIN product p ON p.id_product = s.id_product_stok
                    WHERE s.id_product_shopee = :itemId
                    LIMIT 1
                    `,
                    {
                        replacements: { itemId: String(item.item_id) },
                        type: db.QueryTypes.SELECT,
                    }
                );

                if (stok.length > 0) {
                    const local = stok[0];
                    const gambarBase64 = local.gambar_product
                        ? `data:image/png;base64,${Buffer.from(local.gambar_product).toString("base64")}`
                        : null;

                    items.push({
                        item_id: item.item_id,
                        item_name: item.item_name,
                        variation_name: item.model_name,
                        quantity: item.model_quantity_purchased,
                        price: item.model_discounted_price,
                        from_db: true,
                        id_product_stok: local.id_product_stok,
                        satuan: local.satuan,
                        namet: local.nama_product,
                        image_url: gambarBase64,
                    });
                } else {
                    items.push({
                        item_id: item.item_id,
                        item_name: item.item_name,
                        variation_name: item.model_name,
                        quantity: item.model_quantity_purchased,
                        price: item.model_discounted_price,
                        from_db: false,
                    });
                }
            }

            finalOrders.push({
                order_sn: order.order_sn,
                buyer_username: order.buyer_username,
                total_amount: order.total_amount,
                status: order.order_status,
                recipient_address: order.recipient_address,
                items: [items[0]],
                full_items: items,
            });
        }

        return res.json({
            success: true,
            message: "Berhasil mengambil semua order READY_TO_SHIP + data lokal",
            data: finalOrders,
        });
    } catch (err) {
        console.error("❌ Error getShopeeOrdersWithItems:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil data order Shopee",
            error: err.response?.data || err.message,
        });
    }
};

const getShopeeShippedOrdersWithItems = async (req, res) => {
    try {
        // Ambil token Shopee
        const shop = await Shopee.findOne();
        if (!shop?.access_token || !shop?.shop_id) {
            return res.status(400).json({
                success: false,
                message: "Shopee token atau shop_id tidak ditemukan di database",
            });
        }

        const { shop_id, access_token } = shop;

        const BASE_URL = "https://partner.shopeemobile.com";
        const timestamp = Math.floor(Date.now() / 1000);

        // Hitung 2 hari terakhir
        const now = Math.floor(Date.now() / 1000);
        const twoDaysAgo = now - 2 * 24 * 60 * 60;

        // Ambil order PROCESSED (shipped)
        const path = "/api/v2/order/get_order_list";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        const params = new URLSearchParams({
            partner_id: PARTNER_ID,
            timestamp,
            access_token,
            shop_id,
            sign,
            order_status: "PROCESSED",
            page_size: 100,
            time_range_field: "create_time",
            time_from: twoDaysAgo,
            time_to: now,
        });

        const url = `${BASE_URL}${path}?${params.toString()}`;
        const orderListResp = await axios.get(url, {
            headers: { "Content-Type": "application/json" },
        });

        if (orderListResp.data.error) {
            return res.status(400).json({
                success: false,
                message: orderListResp.data.message || "Shopee API Error",
                shopee_response: orderListResp.data,
            });
        }

        const orderList = orderListResp.data.response?.order_list || [];
        if (orderList.length === 0) {
            return res.json({
                success: true,
                message: "Tidak ada order SHIPPED",
                data: [],
            });
        }

        const finalOrders = [];

        for (const order of orderList) {
            // Ambil detail order
            const detailPath = "/api/v2/order/get_order_detail";
            const detailSign = generateSign(detailPath, timestamp, access_token, shop_id);
            const detailParams = new URLSearchParams({
                partner_id: PARTNER_ID,
                timestamp,
                access_token,
                shop_id,
                sign: detailSign,
                order_sn_list: order.order_sn,
                response_optional_fields: "buyer_username,item_list,total_amount,recipient_address,package_list",
            });

            const detailUrl = `${BASE_URL}${detailPath}?${detailParams.toString()}`;
            const orderDetailResp = await axios.get(detailUrl, { headers: { "Content-Type": "application/json" } });
            const orderDetail = orderDetailResp.data.response?.order_list?.[0];
            if (!orderDetail?.item_list) continue;

            const items = [];

            for (const item of orderDetail.item_list) {
                // Cek DB lokal
                const stok = await db.query(
                    `
                    SELECT 
                        s.id_product_stok,
                        s.id_product_shopee,
                        s.satuan,
                        p.nama_product,
                        p.gambar_product
                    FROM stok s
                    JOIN product p ON p.id_product = s.id_product_stok
                    WHERE s.id_product_shopee = :itemId
                    LIMIT 1
                    `,
                    {
                        replacements: { itemId: String(item.item_id) },
                        type: QueryTypes.SELECT,
                    }
                );

                if (stok.length > 0) {
                    const local = stok[0];
                    const gambarBase64 = local.gambar_product
                        ? `data:image/png;base64,${Buffer.from(local.gambar_product).toString("base64")}`
                        : null;

                    items.push({
                        item_id: item.item_id,
                        item_name: item.item_name,
                        variation_name: item.model_name,
                        quantity: item.model_quantity_purchased,
                        price: item.model_discounted_price,
                        from_db: true,
                        id_product_stok: local.id_product_stok,
                        satuan: local.satuan,
                        nama_product: local.nama_product,
                        image_url: gambarBase64,
                    });
                } else {
                    items.push({
                        item_id: item.item_id,
                        item_name: item.item_name,
                        variation_name: item.model_name,
                        quantity: item.model_quantity_purchased,
                        price: item.model_discounted_price,
                        from_db: false,
                    });
                }
            }

            finalOrders.push({
                order_sn: order.order_sn,
                buyer_username: order.buyer_username,
                total_amount: order.total_amount,
                status: order.order_status,
                recipient_address: order.recipient_address,
                items: [items[0]],
                full_items: items,
            });
        }

        return res.json({
            success: true,
            message: "Berhasil mengambil semua order SHIPPED + data lokal",
            data: finalOrders,
        });

    } catch (err) {
        console.error("❌ Error getShopeeShippedOrdersWithItems:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil data order SHIPPED",
            error: err.response?.data || err.message,
        });
    }
};

const getShippingParameter = async (req, res) => {
    try {
        const { order_sn } = req.body;

        if (!order_sn) {
            return res.status(400).json({
                success: false,
                message: "Field 'order_sn' wajib dikirim di body request",
            });
        }

        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token) {
            return res.status(400).json({
                success: false,
                message: "Shopee token not found. Please authorize first.",
            });
        }

        const { shop_id, access_token } = shopeeData;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/logistics/get_shipping_parameter";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}&order_sn=${order_sn}`;

        const response = await axios.get(url);

        if (response.data.error) {
            return res.status(400).json({
                success: false,
                message: response.data.message || "Gagal mendapatkan shipping parameter",
                shopee_response: response.data,
            });
        }

        return res.json({
            success: true,
            data: response.data.response,
        });
    } catch (err) {
        console.error("❌ Error getShippingParameter:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mendapatkan shipping parameter",
            error: err.response?.data || err.message,
        });
    }
};

const setShopeePickup = async (req, res) => {
    try {
        const { order_sn, address_id, package_number, pickup_time_id } = req.body;
        if (!order_sn || !address_id) {
            return res.status(400).json({ success: false, message: "Field 'order_sn' dan 'address_id' wajib diisi" });
        }

        // Ambil user login
        const currentUser = req.user;
        if (!currentUser || !['pegawai online', 'admin'].includes(currentUser.role)) {
            return res.status(403).json({ success: false, message: 'Hanya pegawai online atau admin yang dapat membuat transaksi' });
        }

        // Tentukan id_user transaksi
        let idUserForTransaction;
        if (currentUser.role === 'pegawai online') {
            idUserForTransaction = currentUser.id_user;
        } else {
            const pegawaiOnline = await User.findOne({ where: { role: 'pegawai online' } });
            if (!pegawaiOnline) return res.status(500).json({ success: false, message: 'Pegawai online tidak ditemukan di DB' });
            idUserForTransaction = pegawaiOnline.id_user;
        }

        // Ambil detail order dari Shopee
        const detailResp = await axios.get(`https://tokalphaomegaploso.my.id/api/shopee/order-detail?order_sn_list=${order_sn}`);
        if (!detailResp.data.success) return res.status(400).json({ success: false, message: detailResp.data.message });
        const order = detailResp.data.data?.[0];
        if (!order) return res.status(404).json({ success: false, message: "Order tidak ditemukan" });

        // Cek stok & validasi item
        const itemsForTransaction = [];
        const stokTidakCukup = [];
        const itemTidakDitemukan = [];

        for (const item of order.items) {
            if (!item.id_product_stok) {
                itemTidakDitemukan.push({ item_id: item.item_id, message: "Item tidak ditemukan di DB lokal" });
                continue;
            }

            const stock = await Stok.findOne({ where: { id_product_stok: item.id_product_stok, satuan: item.satuan } });
            if (!stock) {
                itemTidakDitemukan.push({ item_id: item.id_product_stok, message: "Item tidak ditemukan di DB lokal" });
                continue;
            }

            if (stock.stok < item.quantity) {
                stokTidakCukup.push({
                    id_produk: stock.id_product_stok,
                    nama_produk: item.name,
                    stok_tersedia: stock.stok,
                    jumlah_diminta: item.quantity,
                    message: "Stok tidak cukup"
                });
                continue;
            }

            itemsForTransaction.push({
                id_produk: item.id_product_stok,
                satuan: item.satuan,
                jumlah_barang: item.quantity,
                harga_satuan: item.price,
                subtotal: item.quantity * item.price
            });
        }

        if (itemTidakDitemukan.length > 0) {
            return res.status(400).json({ success: false, message: "Beberapa item tidak ditemukan di DB lokal", items: itemTidakDitemukan });
        }
        if (stokTidakCukup.length > 0) {
            return res.status(400).json({ success: false, message: "Stok tidak cukup untuk beberapa item", items: stokTidakCukup });
        }

        // Buat HTransJual
        const id_htrans_jual = await generateHTransJualId();
        const nomor_invoice = await generateInvoiceNumber();
        await HTransJual.create({
            id_htrans_jual,
            id_user: idUserForTransaction,
            id_user_penjual: idUserForTransaction,
            nama_pembeli: order.buyer_username,
            tanggal: new Date(),
            total_harga: Math.floor(order.total_amount),
            metode_pembayaran: "Debit",
            nomor_invoice,
            order_sn: order.order_sn,
            package_number: null,
            status: "Pending",
            sumber_transaksi: "shopee",
        });

        // Buat DTransJual & update stok
        for (const item of itemsForTransaction) {
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

            const stock = await Stok.findOne({ where: { id_product_stok: item.id_produk, satuan: item.satuan } });
            await stock.update({ stok: stock.stok - item.jumlah_barang });
        }

        // Panggil Shopee Pickup API
        const shopeeData = await Shopee.findOne();
        const { shop_id, access_token } = shopeeData;
        const timestamp = Math.floor(Date.now() / 1000);
        const pathShip = "/api/v2/logistics/ship_order";
        const signShip = generateSign(pathShip, timestamp, access_token, shop_id);
        const urlShip = `https://partner.shopeemobile.com${pathShip}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${signShip}`;

        const payloadShip = { order_sn, pickup: { address_id } };
        if (package_number) payloadShip.package_number = package_number;
        if (pickup_time_id) payloadShip.pickup.pickup_time_id = pickup_time_id;

        const shipResp = await axios.post(urlShip, payloadShip, { headers: { "Content-Type": "application/json" } });
        if (shipResp.data.error) return res.status(400).json({ success: false, message: "Pickup Shopee gagal", shopee_response: shipResp.data });

        const pkgNumber = shipResp.data.response?.result_list?.[0]?.package_number || package_number || null;
        if (pkgNumber) await HTransJual.update({ package_number: pkgNumber }, { where: { id_htrans_jual } });

        return res.json({
            success: true,
            message: "Pickup berhasil dan transaksi jual dibuat",
            invoice: nomor_invoice,
            id_htrans_jual,
            package_number: pkgNumber,
            jumlah_item: itemsForTransaction.length,
            shopee_response: shipResp.data,
        });

    } catch (err) {
        console.error("❌ Error Pickup:", err.response?.data || err.message);
        return res.status(500).json({ success: false, message: err.message, error: err.response?.data || err.message });
    }
};

const setShopeeDropoff = async (req, res) => {
    try {
        const { order_sn } = req.body;
        if (!order_sn) return res.status(400).json({ success: false, message: "Field 'order_sn' wajib diisi" });

        const currentUser = req.user;
        if (!currentUser || !['pegawai online', 'admin'].includes(currentUser.role)) {
            return res.status(403).json({ success: false, message: 'Hanya pegawai online atau admin yang dapat membuat transaksi' });
        }

        let idUserForTransaction;
        if (currentUser.role === 'pegawai online') {
            idUserForTransaction = currentUser.id_user;
        } else {
            const pegawaiOnline = await User.findOne({ where: { role: 'pegawai online' } });
            if (!pegawaiOnline) return res.status(500).json({ success: false, message: 'Pegawai online tidak ditemukan di DB' });
            idUserForTransaction = pegawaiOnline.id_user;
        }

        // Cek transaksi di DB
        let existingOrder = await HTransJual.findOne({ where: { order_sn } });

        // Ambil detail order Shopee
        const detailResp = await axios.get(`https://tokalphaomegaploso.my.id/api/shopee/order-detail?order_sn_list=${order_sn}`);
        if (!detailResp.data.success) return res.status(400).json({ success: false, message: detailResp.data.message });
        const order = detailResp.data.data?.[0];
        if (!order) return res.status(404).json({ success: false, message: "Order tidak ditemukan" });

        const itemsForTransaction = [];
        const stokTidakCukup = [];

        if (!existingOrder) {
            for (const item of order.items) {
                const stock = await Stok.findOne({ where: { id_product_stok: item.id_product_stok, satuan: item.satuan } });
                if (!stock || stock.stok < item.quantity) {
                    stokTidakCukup.push({
                        id_produk: item.id_product_stok,
                        satuan: item.satuan,
                        stok_tersedia: stock ? stock.stok : 0,
                        jumlah_diminta: item.quantity,
                    });
                } else {
                    itemsForTransaction.push({
                        id_produk: item.id_product_stok,
                        satuan: item.satuan,
                        jumlah_barang: item.quantity,
                        harga_satuan: item.price,
                        subtotal: item.quantity * item.price,
                    });
                }
            }
            if (stokTidakCukup.length) return res.status(400).json({ success: false, message: "Stok tidak cukup", stok_tidak_cukup: stokTidakCukup });
        }

        // Buat transaksi baru kalau belum ada
        let id_htrans_jual, nomor_invoice, package_number;
        if (!existingOrder) {
            id_htrans_jual = await generateHTransJualId();
            nomor_invoice = await generateInvoiceNumber();

            await HTransJual.create({
                id_htrans_jual,
                id_user: idUserForTransaction,
                id_user_penjual: idUserForTransaction,
                nama_pembeli: order.buyer_username,
                tanggal: new Date(),
                total_harga: Math.floor(order.total_amount),
                metode_pembayaran: "Debit",
                nomor_invoice,
                order_sn: order.order_sn,
                package_number: null,
                status: "Pending",
                sumber_transaksi: "shopee",
            });

            for (const item of itemsForTransaction) {
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

                const stock = await Stok.findOne({ where: { id_product_stok: item.id_produk, satuan: item.satuan } });
                await stock.update({ stok: stock.stok - item.jumlah_barang });
            }
        } else {
            id_htrans_jual = existingOrder.id_htrans_jual;
            nomor_invoice = existingOrder.nomor_invoice;
            package_number = existingOrder.package_number;
        }

        // Panggil Shopee Dropoff API
        const shopeeData = await Shopee.findOne();
        const { shop_id, access_token } = shopeeData;
        const timestamp = Math.floor(Date.now() / 1000);
        const pathShip = "/api/v2/logistics/ship_order";
        const signShip = generateSign(pathShip, timestamp, access_token, shop_id);
        const urlShip = `https://partner.shopeemobile.com${pathShip}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${signShip}`;

        const payloadShip = { order_sn, dropoff: { branch_id: null } };
        if (package_number) payloadShip.package_number = package_number;

        const shipResp = await axios.post(urlShip, payloadShip, { headers: { "Content-Type": "application/json" } });
        if (shipResp.data.error) return res.status(400).json({ success: false, message: "Dropoff Shopee gagal", shopee_response: shipResp.data });

        // Ambil package_number kalau belum ada
        if (!package_number) {
            const pathPkg = "/api/v2/order/get_package_list";
            const timestamp2 = Math.floor(Date.now() / 1000);
            const signPkg = generateSign(pathPkg, timestamp2, access_token, shop_id);
            const urlPkg = `https://partner.shopeemobile.com${pathPkg}?partner_id=${PARTNER_ID}&timestamp=${timestamp2}&access_token=${access_token}&shop_id=${shop_id}&sign=${signPkg}&order_sn_list=${order_sn}`;

            const pkgResp = await axios.get(urlPkg);
            package_number = pkgResp.data.response?.order_list?.[0]?.package_list?.[0]?.package_number || null;
            if (package_number) await HTransJual.update({ package_number }, { where: { order_sn } });
        }

        return res.json({
            success: true,
            message: "Dropoff berhasil dan transaksi jual tersimpan",
            invoice: nomor_invoice,
            id_htrans_jual,
            package_number,
        });

    } catch (err) {
        console.error("❌ Error Dropoff:", err.response?.data || err.message);
        return res.status(500).json({ success: false, message: err.message, error: err.response?.data || err.message });
    }
};

const getShopeeTrackingInfo = async (req, res) => {
    try {
        const { order_sn, package_number } = req.body; // 🔹 ambil dari body

        // 🔹 Validasi input
        if (!order_sn || !package_number) {
            return res.status(400).json({
                success: false,
                message: "Field 'order_sn' dan 'package_number' wajib diisi.",
            });
        }

        // 🔹 Ambil data Shopee Auth dari DB
        const shopeeData = await Shopee.findOne();
        if (!shopeeData) {
            return res.status(400).json({
                success: false,
                message: "Data Shopee tidak ditemukan.",
            });
        }

        const { shop_id, access_token } = shopeeData;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/logistics/get_tracking_info";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        // 🔹 URL langsung ke Shopee API
        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}&order_sn=${order_sn}&package_number=${package_number}`;

        // 🔹 GET request ke Shopee API
        const response = await axios.get(url);

        const result = response.data?.response || {};
        return res.json({
            success: true,
            message: "Berhasil ambil tracking info Shopee",
            data: result,
            shopee_response: response.data,
        });
    } catch (err) {
        console.error("❌ Error getShopeeTrackingInfo:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal ambil tracking info Shopee",
            error: err.response?.data || err.message,
        });
    }
};

const createShopeeShippingDocument = async (req, res) => {
    try {
        const { order_list } = req.body;

        if (!order_list || !Array.isArray(order_list) || !order_list.length) {
            return res.status(400).json({
                success: false,
                message: "order_list wajib dikirim dan harus array",
            });
        }

        // ambil credential Shopee dari DB
        const shop = await Shopee.findOne();
        if (!shop?.access_token || !shop?.shop_id) {
            return res.status(400).json({
                success: false,
                message: "Shopee token atau shop_id tidak tersedia",
            });
        }

        const { shop_id, access_token } = shop;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/logistics/create_shipping_document";

        const sign = generateSign(path, timestamp, access_token, shop_id);
        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&shop_id=${shop_id}&timestamp=${timestamp}&access_token=${access_token}&sign=${sign}`;

        const payload = {
            order_list, // [{ order_sn: "...", package_number: "...", tracking_number: "...", shipping_document_type: "NORMAL_AIR_WAYBILL" }]
        };

        const response = await axios.post(url, payload, {
            headers: { "Content-Type": "application/json" },
            timeout: 60000,
        });

        if (response.data.error) {
            return res.status(400).json({
                success: false,
                message: response.data.message || "Gagal create shipping document",
                shopee_response: response.data,
            });
        }

        return res.json({
            success: true,
            message: "Create shipping document berhasil",
            data: response.data.response?.result_list || [],
            shopee_response: response.data,
        });

    } catch (err) {
        console.error("❌ Error createShopeeShippingDocument:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal create shipping document",
            error: err.response?.data || err.message,
        });
    }
};

const getShippingDocumentResultController = async (req, res) => {
    try {
        const { order_sn, package_number, shipping_document_type } = req.body;

        if (!order_sn) {
            return res.status(400).json({
                success: false,
                message: "Field 'order_sn' wajib diisi",
            });
        }

        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token || !shopeeData?.shop_id) {
            return res.status(400).json({
                success: false,
                message: "Shopee credentials tidak ditemukan",
            });
        }

        const { shop_id, access_token } = shopeeData;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/logistics/get_shipping_document_result";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}`;

        const payload = {
            shipping_document_type: shipping_document_type || "NORMAL_AIR_WAYBILL",
            order_list: [
                { order_sn, package_number: package_number || null }
            ]
        };

        const response = await axios.post(url, payload, {
            headers: { "Content-Type": "application/json" },
            timeout: 60000,
        });

        if (response.data.error) {
            return res.status(400).json({
                success: false,
                message: response.data.message || "Gagal ambil shipping document result",
                shopee_response: response.data,
            });
        }

        return res.json({
            success: true,
            message: "Berhasil ambil shipping document result",
            data: response.data,
        });

    } catch (err) {
        console.error("❌ Error getShippingDocumentResultController:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal ambil shipping document result",
            error: err.response?.data || err.message,
        });
    }
};

const getShippingDocumentInfo = async (req, res) => {
    try {
        const { order_sn, package_number } = req.body;

        if (!order_sn) {
            return res.status(400).json({
                success: false,
                message: "Field 'order_sn' wajib diisi.",
            });
        }

        // 🔹 Ambil auth Shopee dari DB
        const shopeeData = await Shopee.findOne();
        if (!shopeeData) {
            return res.status(400).json({
                success: false,
                message: "Data Shopee tidak ditemukan di database.",
            });
        }

        const { shop_id, access_token } = shopeeData;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/logistics/get_shipping_document_data_info";

        const sign = generateSign(path, timestamp, access_token, shop_id);

        // 🔹 URL resmi Shopee (production)
        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}`;

        // 🔹 Body request minimal (tanpa recipient_address_info)
        const payload = { order_sn };
        if (package_number) payload.package_number = package_number;

        // 🔹 Request ke Shopee API
        const response = await axios.post(url, payload);

        const data = response.data?.response || {};

        return res.json({
            success: true,
            message: "Berhasil ambil shipping document info Shopee",
            data: {
                unpackaged_sku_id: data.shipping_document_info?.unpackaged_sku_id || null,
                unpackaged_sku_id_qrcode: data.shipping_document_info?.unpackaged_sku_id_qrcode || null,
                logistics_channel_id: data.shipping_document_info?.logistics_channel_id || null,
                shipping_carrier: data.shipping_document_info?.shipping_carrier || null,
            },
            shopee_response: response.data,
        });
    } catch (err) {
        console.error("❌ Error getShippingDocumentInfo:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal ambil shipping document info Shopee",
            error: err.response?.data || err.message,
        });
    }
};

const downloadShippingDocumentController = async (req, res) => {
    try {
        const { order_sn, package_number, shipping_document_type } = req.body;
        console.log("📥 Downloading shipping document for order_sn:", order_sn);

        // Ambil data toko
        const shop = await Shopee.findOne();
        if (!shop) throw new Error("Shopee auth not found");

        const { shop_id, access_token } = shop;
        const timestamp = Math.floor(Date.now() / 1000);
        const pathApi = "/api/v2/logistics/download_shipping_document";
        const sign = generateSign(pathApi, timestamp, access_token, shop_id);

        // Shopee API URL
        const url = `https://partner.shopeemobile.com${pathApi}?partner_id=${PARTNER_ID}&shop_id=${shop_id}&timestamp=${timestamp}&access_token=${access_token}&sign=${sign}`;

        // Payload
        const payload = {
            order_list: [{ order_sn, package_number, shipping_document_type }],
        };

        // Request ke Shopee (stream file)
        const response = await axios.post(url, payload, {
            responseType: "stream",
            timeout: 300000,
            headers: { "Content-Type": "application/json" },
        });

        // Set header biar browser/frontend tahu ini file PDF
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="shopee_shipping_${order_sn}.pdf"`);

        // Stream langsung ke response (frontend)
        response.data.pipe(res);

        response.data.on("end", () => {
            console.log("✅ File PDF berhasil dikirim ke frontend");
        });

        response.data.on("error", (err) => {
            console.error("❌ Error streaming:", err);
            res.status(500).json({ success: false, message: "Gagal mengirim file PDF" });
        });

    } catch (error) {
        console.error("❌ Error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

const printShopeeResi = async (req, res) => {
    const { order_sn } = req.body;

    if (!order_sn) {
        return res.status(400).json({ success: false, message: "order_sn required" });
    }

    try {
        // 🔹 1. Ambil data Shopee dari DB
        const shop = await Shopee.findOne();
        if (!shop?.access_token || !shop?.shop_id) {
            return res.status(400).json({ success: false, message: "Shopee token atau shop_id tidak ditemukan" });
        }

        const { shop_id, access_token } = shop;

        // 🔹 2. Ambil detail order → untuk dapatkan package_number
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/order/get_order_detail";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        const params = new URLSearchParams({
            partner_id: PARTNER_ID,
            timestamp,
            access_token,
            shop_id,
            sign,
            order_sn_list: order_sn,
            response_optional_fields:
                "buyer_username,item_list,total_amount,recipient_address,package_list,pickup_done_time,booking_sn,advance_package",
        });

        const detailResp = await axios.get(`https://partner.shopeemobile.com${path}?${params.toString()}`);
        const orderData = detailResp.data.response.order_list?.[0];

        if (!orderData || !orderData.package_list?.length) {
            return res.status(400).json({
                success: false,
                message: "Gagal menemukan package_number untuk order ini",
                shopee_response: detailResp.data,
            });
        }

        const packageNumber = orderData.package_list[0].package_number;
        console.log(`✅ Order SN: ${order_sn}, Package Number: ${packageNumber}`);

        // 🔹 3. Get Tracking Info → kirim order_sn + package_number
        const shippingInfoResp = await axios.post(
            "https://tokalphaomegaploso.my.id/api/shopee/shipping-info",
            {
                order_sn,
                package_number: packageNumber,
            },
            { headers: { "Content-Type": "application/json" } }
        );

        const trackingNumber =
            shippingInfoResp.data?.shopee_response?.response?.shipping_document_info?.tracking_number;

        if (!trackingNumber) {
            return res.status(400).json({
                success: false,
                message: "Tracking number tidak ditemukan dari shipping-info",
                response: shippingInfoResp.data,
            });
        }

        console.log(`✅ Tracking Number: ${trackingNumber}`);

        // 🔹 4. Create Shipping Document
        await axios.post(
            "https://tokalphaomegaploso.my.id/api/shopee/create-document",
            {
                order_list: [
                    {
                        order_sn,
                        package_number: packageNumber,
                        tracking_number: trackingNumber,
                        shipping_document_type: "NORMAL_AIR_WAYBILL",
                    },
                ],
            },
            { headers: { "Content-Type": "application/json" } }
        );

        console.log(`✅ Shipping document created for ${order_sn}`);

        // 🔹 5. Download Resi (stream langsung seperti contoh kamu)
        const pathApi = "/api/v2/logistics/download_shipping_document";
        const sign2 = generateSign(pathApi, timestamp, access_token, shop_id);
        const url = `https://partner.shopeemobile.com${pathApi}?partner_id=${PARTNER_ID}&shop_id=${shop_id}&timestamp=${timestamp}&access_token=${access_token}&sign=${sign2}`;

        const payload = {
            order_list: [
                {
                    order_sn,
                    package_number: packageNumber,
                    shipping_document_type: "NORMAL_AIR_WAYBILL",
                },
            ],
        };

        console.log(`📥 Downloading shipping document for ${order_sn}...`);

        const response = await axios.post(url, payload, {
            responseType: "stream",
            timeout: 300000,
            headers: { "Content-Type": "application/json" },
        });

        // 🔹 Ambil PDF buffer dari Shopee
        const pdfBuffer = await new Promise((resolve, reject) => {
            const chunks = [];
            response.data.on("data", (chunk) => chunks.push(chunk));
            response.data.on("end", () => resolve(Buffer.concat(chunks)));
            response.data.on("error", reject);
        });

        // 🔹 Encode ke base64 biar bisa ditampilkan di frontend
        const pdfBase64 = pdfBuffer.toString("base64");

        res.status(200).json({
            success: true,
            message: `Resi Shopee untuk ${order_sn}`,
            order_sn,
            package_number: packageNumber,
            tracking_number: trackingNumber,
            pdf_base64: pdfBase64,
        });

        response.data.on("end", () => {
            console.log(`✅ File PDF berhasil dikirim ke frontend untuk ${order_sn}`);
        });

        response.data.on("error", (err) => {
            console.error("❌ Error streaming PDF:", err);
            res.status(500).json({ success: false, message: "Gagal mengirim file PDF" });
        });
    } catch (err) {
        console.error("❌ Error printShopeeResi:", err.response?.data || err.message);

        const failedApi = err.config?.url || "Unknown API";
        res.status(500).json({
            success: false,
            message: "Gagal print resi",
            error_from: failedApi,
            error: err.response?.data || err.message,
        });
    }
};

const updateStockShopee = async (req, res) => {
    try {
        const { item_id, stock } = req.body;

        if (!item_id || stock === undefined) {
            return res.status(400).json({
                success: false,
                message: "item_id dan stock wajib diisi",
            });
        }

        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token) {
            return res.status(400).json({
                success: false,
                message: "Shopee token not found. Please authorize first.",
            });
        }

        const access_token = shopeeData.access_token;
        const shop_id = shopeeData.shop_id;

        // === SIGNING SHOPEE REQUEST ===
        const path = "/api/v2/product/update_stock";
        const timestamp = Math.floor(Date.now() / 1000);
        const baseString = `${PARTNER_ID}${path}${timestamp}${access_token}${shop_id}`;
        const sign = crypto
            .createHmac("sha256", PARTNER_KEY)
            .update(baseString)
            .digest("hex");

        // === REQUEST BODY ===
        const body = {
            item_id: Number(item_id),
            stock_list: [
                {
                    model_id: 0, // tidak digunakan (default)
                    seller_stock: [{ stock: Number(stock) }],
                },
            ],
        };

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}&access_token=${access_token}&shop_id=${shop_id}`;

        const response = await axios.post(url, body, {
            headers: { "Content-Type": "application/json" },
        });

        return res.status(200).json({
            success: true,
            message: "Berhasil update stok Shopee",
            data: response.data,
            debug: {
                url,
                body,
            },
        });
    } catch (err) {
        console.error("❌ Gagal update stok Shopee:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal update stok Shopee",
            error: err.response?.data || err.message,
        });
    }
};

const getShopeeAttributeTree = async (req, res) => {
    try {
        const { category_id } = req.params;
        if (!category_id) return res.status(400).json({ success: false, message: "category_id wajib diisi" });

        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token || !shopeeData?.shop_id) {
            return res.status(400).json({ success: false, message: "Shopee token atau shop_id tidak ditemukan" });
        }

        const { shop_id, access_token } = shopeeData;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/product/get_attribute_tree";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}&category_id_list=${category_id}&language=id`;

        const response = await axios.get(url, { headers: { "Content-Type": "application/json" } });

        if (response.data.error) {
            return res.status(400).json({
                success: false,
                message: response.data.message || "Shopee API Error",
                shopee_response: response.data,
            });
        }

        return res.json({
            success: true,
            message: "Berhasil ambil attribute tree Shopee",
            data: response.data.response?.list?.[0]?.attribute_tree || [],
            shopee_response: response.data,
        });

    } catch (err) {
        console.error("❌ Shopee Get Attribute Tree Error:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal ambil attribute tree Shopee",
            error: err.response?.data || err.message,
        });
    }
};

module.exports = {
    shopeeCallback,
    getShopeeItemList,
    createProductShopee,
    getShopeeCategories,
    getShopeeLogistics,
    getBrandListShopee,
    updateProductShopee,
    getShopeeItemInfo,
    getShopeeOrders,
    getShopeeShippedOrders,
    getOrderDetail,
    searchShopeeProductByName,
    getShopeeOrdersWithItems,
    getShopeeShippedOrdersWithItems,
    getShippingParameter,
    setShopeePickup,
    setShopeeDropoff,
    getShopeeTrackingInfo,
    getShippingDocumentInfo,
    getShippingDocumentResultController,
    createShopeeShippingDocument,
    downloadShippingDocumentController,
    printShopeeResi,
    updateStockShopee,
    getShopeeAttributeTree
};
