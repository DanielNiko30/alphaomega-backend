const axios = require('axios');
const fs = require("fs");
const crypto = require('crypto');
const { Lazada } = require('../model/lazada_model');
const { Product } = require('../model/product_model');
const { Stok } = require('../model/stok_model');
const FormData = require("form-data");
const sharp = require("sharp");
const qs = require("qs");
const { Builder } = require("xml2js");
/**
* @param {string} apiPath
 * @param {Object<string, string>} allParams
 * @param {string} appSecret
 * @returns {string}
 * @param {number} weightBody
 * @param {Array} options
 * @returns {string}
 */
function generateSign(apiPath, allParams, appSecret) {
    // 1. Urutkan SEMUA parameter (System + Payload) secara ASCII.
    const sortedKeys = Object.keys(allParams).sort();

    // 2. Inisiasi base string dengan API Path
    let baseStr = apiPath;

    // 3. Gabungkan parameter yang diurutkan (Key + Value)
    for (const key of sortedKeys) {
        // Nilai yang digunakan adalah JSON mentah (sesuai allParams)
        const value = allParams[key];
        baseStr += key + value;
    }

    // --- DEBUGGING: Cetak base string untuk verifikasi manual ---
    // console.log("BASE STRING FOR SIGNATURE:", baseStr); 
    // -----------------------------------------------------------

    // 4. Lakukan HMAC SHA256
    return crypto.createHmac("sha256", appSecret)
        .update(baseStr, "utf8")
        .digest("hex")
        .toUpperCase();
}


/**
 * @param {*} req 
 * @param {*} res 
 */

const generateLoginUrl = (req, res) => {
    try {
        const CLIENT_ID = process.env.LAZADA_APP_KEY;
        const REDIRECT_URI = encodeURIComponent('https://tokalphaomegaploso.my.id/api/lazada/callback');
        const state = Math.random().toString(36).substring(2, 15);
        const loginUrl = `https://auth.lazada.com/oauth/authorize?response_type=code&force_auth=true&redirect_uri=${REDIRECT_URI}&client_id=${CLIENT_ID}&state=${state}`;
        return res.json({ login_url: loginUrl });
    } catch (err) {
        console.error("Generate Login URL Error:", err.message);
        return res.status(500).json({ error: 'Gagal generate login URL' });
    }
};

const lazadaCallback = async (req, res) => {
    try {
        const { code, state } = req.query;
        if (!code) return res.status(400).json({ error: "Missing code from Lazada callback" });

        const CLIENT_ID = process.env.LAZADA_APP_KEY;
        const CLIENT_SECRET = process.env.LAZADA_APP_SECRET;
        const API_PATH = "/auth/token/create";
        const timestamp = String(Date.now());

        const params = {
            app_key: CLIENT_ID,
            code,
            sign_method: "sha256",
            timestamp
        };
        params.sign = generateSign(API_PATH, params, CLIENT_SECRET);

        const url = `https://api.lazada.com/rest${API_PATH}`;
        const response = await axios.post(url, new URLSearchParams(params), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const tokenData = response.data;
        if (!tokenData.access_token) return res.status(400).json({ error: "Invalid token response from Lazada", data: tokenData });

        await Lazada.destroy({ where: {} });
        await Lazada.create({
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            account: tokenData.account,
            expires_in: tokenData.expires_in,
            last_updated: Math.floor(Date.now() / 1000)
        });

        return res.json({ success: true, state, tokenData });
    } catch (err) {
        console.error("Lazada Callback Error:", err.response?.data || err.message);
        return res.status(500).json({ error: err.response?.data || err.message });
    }
};

const refreshToken = async () => {
    const CLIENT_ID = process.env.LAZADA_APP_KEY;
    const CLIENT_SECRET = process.env.LAZADA_APP_SECRET;
    const API_PATH = "/auth/token/refresh";
    const timestamp = String(Date.now());

    const lazadaData = await Lazada.findOne();
    if (!lazadaData) throw new Error("Lazada token not found");

    const params = {
        app_key: CLIENT_ID,
        refresh_token: lazadaData.refresh_token,
        sign_method: "sha256",
        timestamp
    };
    params.sign = generateSign(API_PATH, params, CLIENT_SECRET);

    const url = `https://api.lazada.com/rest${API_PATH}`;
    const response = await axios.post(url, new URLSearchParams(params), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const tokenData = response.data;
    if (!tokenData.access_token) throw new Error("Failed to refresh Lazada token");

    await lazadaData.update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || lazadaData.refresh_token,
        expires_in: tokenData.expires_in,
        last_updated: Math.floor(Date.now() / 1000)
    });

    return tokenData.access_token;
};

const getProducts = async (req, res) => {
    try {
        const lazadaData = await Lazada.findOne();
        if (!lazadaData?.access_token) {
            return res.status(400).json({ error: "Token Lazada not found" });
        }

        const access_token = lazadaData.access_token;
        const API_PATH = "/products/get";
        const timestamp = String(Date.now());
        const { filter = "all", limit = 10 } = req.query;

        const params = {
            app_key: process.env.LAZADA_APP_KEY,
            sign_method: "sha256",
            timestamp,
            access_token,
            filter,
            limit
        };

        params.sign = generateSign(API_PATH, params, process.env.LAZADA_APP_SECRET);

        const url = `https://api.lazada.co.id/rest${API_PATH}?${new URLSearchParams(params).toString()}`;

        const response = await axios.get(url);

        return res.json({
            success: true,
            url,                  // URL lengkap yang dipakai
            params,               // Optional: tunjukkan query params juga
            lazada_response: response.data
        });
    } catch (err) {
        console.error("❌ Lazada Get Products Error:", err.response?.data || err.message);
        return res.status(500).json({
            error: err.response?.data || err.message,
            url: err.config?.url || null,   // URL request jika ada error
            params: err.config?.params || null
        });
    }
};

const getAllCategoryAttributes = async (req, res) => {
    try {
        // 🔹 Ambil account Lazada
        const account = await Lazada.findOne();
        if (!account) throw new Error("Tidak ada account Lazada di DB");

        const accessToken = account.access_token.trim();
        const apiKey = process.env.LAZADA_APP_KEY.trim();
        const appSecret = process.env.LAZADA_APP_SECRET.trim();

        const apiPath = "/category/attributes/get";
        const timestamp = Date.now().toString();

        // 🔹 Ambil Category ID dari params / body / query
        const primaryCategoryId =
            req.params.category_id ||
            req.body.category_id ||
            req.query.category_id;

        if (!primaryCategoryId) {
            return res.status(400).json({
                success: false,
                message: "category_id wajib dikirim di params, body, atau query.",
            });
        }

        // 🔹 System params
        const sysParams = {
            app_key: apiKey,
            access_token: accessToken,
            sign_method: "sha256",
            timestamp,
            v: "1.0",
        };

        // 🔹 Business params
        const businessParams = {
            primary_category_id: primaryCategoryId,
            language_code: "id_ID",
        };

        // 🔹 Gabungkan semua parameter untuk signing
        const allParamsForSign = { ...sysParams, ...businessParams };

        // 🔹 Generate signature
        const sign = generateSign(apiPath, allParamsForSign, appSecret);

        // 🔹 Build URL untuk GET request
        const url = `https://api.lazada.co.id/rest${apiPath}?${new URLSearchParams({
            ...allParamsForSign,
            sign,
        }).toString()}`;

        console.log(`📦 Fetching all attributes for category: ${primaryCategoryId}`);

        // 🔹 Request ke Lazada
        const response = await axios.get(url);
        const attributes = response.data?.data || [];

        if (!Array.isArray(attributes) || attributes.length === 0) {
            return res.status(404).json({
                success: false,
                message: `Tidak ada atribut ditemukan untuk Category ID ${primaryCategoryId}.`,
                lazada_response: response.data,
            });
        }

        // 🔹 Mapping semua atribut tanpa filter mandatory
        const allAttributes = attributes.map(attr => ({
            id: attr.id,
            name: attr.name,
            label: attr.label,
            input_type: attr.input_type,
            is_mandatory: attr.is_mandatory,
            is_key_prop: attr.advanced?.is_key_prop || 0,
            is_sale_prop: attr.is_sale_prop || 0,
            options: attr.options?.map(opt => ({
                id: opt.id,
                name: opt.name,
                en_name: opt.en_name
            })) || []
        }));

        res.json({
            success: true,
            message: `Berhasil mendapatkan semua atribut (${allAttributes.length}) untuk Category ID ${primaryCategoryId}.`,
            category_id: primaryCategoryId,
            attributes: allAttributes,
        });

    } catch (err) {
        const errorData = err.response?.data || { message: err.message };
        console.error("❌ Lazada Get All Attributes Error:", errorData);

        res.status(err.response?.status || 500).json({
            success: false,
            error: errorData,
            message: "Gagal mendapatkan atribut dari Lazada.",
        });
    }
};

const getCategoryAttributes = async (req, res) => {
    try {
        // 🔹 Ambil account Lazada
        const account = await Lazada.findOne();
        if (!account) throw new Error("Tidak ada account Lazada di DB");

        const accessToken = account.access_token.trim();
        const apiKey = process.env.LAZADA_APP_KEY.trim();
        const appSecret = process.env.LAZADA_APP_SECRET.trim();

        const apiPath = "/category/attributes/get";
        const timestamp = Date.now().toString();

        // 🔹 Ambil Category ID dari params / body / query
        const primaryCategoryId =
            req.params.category_id ||
            req.body.category_id ||
            req.query.category_id;

        if (!primaryCategoryId) {
            return res.status(400).json({
                success: false,
                message: "category_id wajib dikirim di params, body, atau query.",
            });
        }

        // 🔹 System params
        const sysParams = {
            app_key: apiKey,
            access_token: accessToken,
            sign_method: "sha256",
            timestamp,
            v: "1.0",
        };

        // 🔹 Business params
        const businessParams = {
            primary_category_id: primaryCategoryId,
            language_code: "id_ID",
        };

        // 🔹 Gabungkan semua parameter untuk signing
        const allParamsForSign = { ...sysParams, ...businessParams };

        // 🔹 Generate signature
        const sign = generateSign(apiPath, allParamsForSign, appSecret);

        // 🔹 Build URL untuk GET request
        const url = `https://api.lazada.co.id/rest${apiPath}?${new URLSearchParams({
            ...allParamsForSign,
            sign,
        }).toString()}`;

        console.log(`📦 Fetching attributes for category: ${primaryCategoryId}`);

        // 🔹 Request ke Lazada
        const response = await axios.get(url);
        const attributes = response.data?.data || [];

        if (!Array.isArray(attributes) || attributes.length === 0) {
            return res.status(404).json({
                success: false,
                message: `Tidak ada atribut ditemukan untuk Category ID ${primaryCategoryId}.`,
                lazada_response: response.data,
            });
        }

        // 🔹 Filter hanya atribut yang mandatory (is_mandatory = 1)
        const requiredAttributes = attributes
            .filter(attr => attr.is_mandatory === 1)
            .map(attr => ({
                id: attr.id,
                name: attr.name,
                label: attr.label,
                input_type: attr.input_type,
                is_mandatory: attr.is_mandatory,
                is_key_prop: attr.advanced?.is_key_prop || 0,
                is_sale_prop: attr.is_sale_prop || 0,
                options: attr.options?.map(opt => ({
                    id: opt.id,
                    name: opt.name,
                    en_name: opt.en_name
                })) || []
            }));

        res.json({
            success: true,
            message: `Berhasil mendapatkan ${requiredAttributes.length} atribut mandatory untuk Category ID ${primaryCategoryId}.`,
            category_id: primaryCategoryId,
            required_attributes: requiredAttributes,
        });

    } catch (err) {
        const errorData = err.response?.data || { message: err.message };
        console.error("❌ Lazada Get Attributes Error:", errorData);

        res.status(err.response?.status || 500).json({
            success: false,
            error: errorData,
            message: "Gagal mendapatkan atribut dari Lazada.",
        });
    }
};

async function uploadImageToLazadaFromDB(product, accessToken) {
    if (!product || !product.gambar_product) {
        throw new Error("Produk tidak ditemukan atau tidak memiliki gambar.");
    }

    const imgBuffer = Buffer.from(product.gambar_product);
    const metadata = await sharp(imgBuffer).metadata();

    const optimizedBuffer = await sharp(imgBuffer)
        .resize({ width: Math.max(metadata.width || 400, 400), height: Math.max(metadata.height || 400, 400), fit: "cover" })
        .jpeg({ quality: 85 })
        .toBuffer();

    const tempPath = `/tmp/lazada_upload_${Date.now()}.jpg`;
    fs.writeFileSync(tempPath, optimizedBuffer);

    const API_PATH = "/image/upload";
    const timestamp = Date.now().toString();
    const params = {
        access_token: accessToken,
        app_key: process.env.LAZADA_APP_KEY,
        sign_method: "sha256",
        timestamp,
    };

    const sign = generateSign(API_PATH, params, process.env.LAZADA_APP_SECRET);
    const url = `https://api.lazada.co.id/rest${API_PATH}?${new URLSearchParams({ ...params, sign }).toString()}`;

    const form = new FormData();
    form.append("image", fs.createReadStream(tempPath), { filename: `${product.id_product}.jpg`, contentType: "image/jpeg" });

    try {
        const response = await axios.post(url, form, {
            headers: form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 30000,
        });

        fs.unlinkSync(tempPath);

        const imageUrl =
            response.data?.data?.image?.url ||
            response.data?.data?.url ||
            response.data?.data?.full_url ||
            null;

        if (!imageUrl) throw new Error("Gagal upload gambar ke Lazada, tidak ada URL");

        return imageUrl;
    } catch (err) {
        fs.unlinkSync(tempPath);
        throw new Error("Upload gambar ke Lazada gagal: " + (err.response?.data || err.message));
    }
}

const createProductLazada = async (req, res) => {
    try {
        const { id_product } = req.params;
        const { category_id, selected_unit, attributes = {} } = req.body;

        if (!category_id)
            return res.status(400).json({ success: false, message: "category_id wajib dikirim di body" });

        const account = await Lazada.findOne();
        if (!account) throw new Error("Tidak ada account Lazada di DB");

        const accessToken = account.access_token.trim();
        const apiKey = process.env.LAZADA_APP_KEY.trim();
        const appSecret = process.env.LAZADA_APP_SECRET.trim();
        const apiPath = "/product/create";
        const timestamp = Date.now().toString();
        const uniqueSuffix = Date.now().toString().slice(-6);

        // === Ambil data produk dan stok ===
        const product = await Product.findOne({
            where: { id_product },
            include: [{ model: Stok, as: "stok" }],
        });
        if (!product) throw new Error("Produk tidak ditemukan di database");

        let stokTerpilih;
        if (selected_unit) {
            stokTerpilih = product.stok.find(s => s.satuan === selected_unit);
            if (!stokTerpilih)
                throw new Error(`Stok untuk satuan "${selected_unit}" tidak ditemukan`);
        } else {
            if (!product.stok || product.stok.length === 0)
                throw new Error("Produk tidak memiliki stok sama sekali");
            stokTerpilih = product.stok[0];
        }

        // === Upload gambar ke Lazada ===
        const uploadedImageUrl = await uploadImageToLazadaFromDB(product, accessToken);

        // === Data produk ===
        const productAttributes = {
            name: product.nama_product,
            brand: attributes.brand || "No Brand",
            description: product.deskripsi_product || "Deskripsi belum tersedia",
            short_description: product.deskripsi_product?.slice(0, 100) || "Short description",
            Net_Weight: attributes.Net_Weight || "500 g", // wajib string
        };

        const skuAttributes = {
            SellerSku: attributes.SellerSku || `SKU-${uniqueSuffix}`,
            quantity: String(stokTerpilih.stok),
            price: String(stokTerpilih.harga || 1000),
            package_height: String(attributes.package_height || stokTerpilih.tinggi || 10),
            package_length: String(attributes.package_length || stokTerpilih.panjang || 10),
            package_width: String(attributes.package_width || stokTerpilih.lebar || 10),
            package_weight: String(attributes.package_weight || stokTerpilih.berat || 0.5),
            package_content: `${product.nama_product} - ${attributes.brand || "No Brand"}`,
        };

        const productObj = {
            Request: {
                Product: {
                    PrimaryCategory: category_id,
                    Images: { Image: [uploadedImageUrl] },
                    Attributes: productAttributes,
                    Skus: { Sku: [skuAttributes] },
                },
            },
        };

        const sysParams = {
            app_key: apiKey,
            access_token: accessToken,
            sign_method: "sha256",
            timestamp,
            v: "1.0",
        };

        const jsonBody = JSON.stringify(productObj);
        const sign = generateSign(apiPath, { ...sysParams, payload: jsonBody }, appSecret);
        const url = `https://api.lazada.co.id/rest${apiPath}?${new URLSearchParams({ ...sysParams, sign }).toString()}`;
        const bodyForRequest = new URLSearchParams({ payload: jsonBody });

        // === Kirim request ke Lazada ===
        const response = await axios.post(url, bodyForRequest, {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });

        const lazadaResponse = response.data;
        const itemId = lazadaResponse?.data?.item_id || null;
        const skuId = lazadaResponse?.data?.sku_list?.[0]?.sku_id || null; // ⬅ ambil sku_id

        // === Kalau berhasil, simpan item_id dan sku_id ke stok ===
        if (itemId || skuId) {
            await Stok.update(
                {
                    id_product_lazada: itemId || stokTerpilih.id_product_lazada,
                    sku_lazada: skuId || null,
                },
                { where: { id_stok: stokTerpilih.id_stok } }
            );
        }

        res.json({
            success: true,
            message: "Produk berhasil ditambahkan ke Lazada.",
            image_used: uploadedImageUrl,
            item_id: itemId,
            sku_id: skuId,
            stok_updated: stokTerpilih.id_stok,
            lazada_response: lazadaResponse,
        });

    } catch (err) {
        console.error("❌ Lazada Create Product Error:", err);
        res.status(500).json({
            success: false,
            error: err.response?.data || err.message,
            message: "Gagal membuat produk di Lazada.",
        });
    }
};

// const createDummyProduct = async (req, res) => {
//     try {
//         // 1️⃣ Ambil akun Lazada
//         const account = await Lazada.findOne();
//         if (!account) throw new Error("Tidak ada account Lazada di DB");

//         const accessToken = account.access_token.trim();
//         const apiKey = process.env.LAZADA_APP_KEY.trim();
//         const appSecret = process.env.LAZADA_APP_SECRET.trim();

//         const apiPath = "/product/create";
//         const timestamp = Date.now().toString();
//         const uniqueSuffix = Date.now().toString().slice(-6);

//         // 2️⃣ Pakai URL gambar langsung
//         const uploadedImageUrl =
//             "https://ae01.alicdn.com/kf/S4b0a02ef50ab42ac805f39ab31d4cf30r/3-Pieces-Boho-Canvas-Tote-Bag-Reusable-Aesthetic-Canvas-Bag-Minimalist-Canvas-Totes-School-Shoulder-Bag-For.jpg";

//         console.log("✅ Menggunakan gambar URL langsung:", uploadedImageUrl);

//         // 3️⃣ Payload produk (kategori: Tote Bag Wanita - 17935)
//         const sysParams = {
//             app_key: apiKey,
//             access_token: accessToken,
//             sign_method: "sha256",
//             timestamp,
//             v: "1.0",
//         };

//         const productObj = {
//             Request: {
//                 Product: {
//                     PrimaryCategory: "18469", // Tote Bag Wanita
//                     Images: { Image: [uploadedImageUrl] },
//                     Attributes: {
//                         name: "TEST-TOTE-BAG-" + uniqueSuffix,
//                         brand: "No Brand",
//                         description:
//                             "Tas Tote Bag Wanita (Canvas) untuk percobaan API Lazada.",
//                         short_description: "Tote Bag Kanvas API Test.",
//                         Net_Weight: "500 g",
//                     },
//                     Skus: {
//                         Sku: [
//                             {
//                                 SellerSku: "SKU-TOTE-" + uniqueSuffix,
//                                 quantity: 3,
//                                 price: 1000,
//                                 package_height: 3,
//                                 package_length: 35,
//                                 package_width: 30,
//                                 package_weight: 0.2,
//                                 package_content: "1x Tote Bag Wanita",
//                             },
//                         ],
//                     },
//                 },
//             },
//         };

//         // 4️⃣ Signing & Request
//         const jsonBody = JSON.stringify(productObj);
//         const allParamsForSign = { ...sysParams, payload: jsonBody };
//         const sign = generateSign(apiPath, allParamsForSign, appSecret);

//         const url = `https://api.lazada.co.id/rest${apiPath}?${new URLSearchParams({
//             ...sysParams,
//             sign,
//         }).toString()}`;

//         const bodyForRequest = new URLSearchParams({ payload: jsonBody });

//         // 5️⃣ Kirim request
//         const response = await axios.post(url, bodyForRequest, {
//             headers: { "Content-Type": "application/x-www-form-urlencoded" },
//         });

//         // ✅ Success
//         res.json({
//             success: true,
//             message: "Produk dummy berhasil dibuat (kategori Tote Bag Wanita).",
//             image_used: uploadedImageUrl,
//             lazada_response: response.data,
//         });
//     } catch (err) {
//         console.error("❌ Create Dummy Product Error:", err.response?.data || err.message);
//         res.status(500).json({
//             error: err.response?.data || err.message,
//             message: "Gagal membuat produk dummy ke Lazada.",
//         });
//     }
// };

const getProductItemLazada = async (req, res) => {
    try {
        const { item_id } = req.query;

        if (!item_id)
            return res.status(400).json({
                success: false,
                message: "Parameter 'item_id' wajib dikirim di query",
            });

        // 🔐 Ambil akun Lazada dari DB
        const account = await Lazada.findOne();
        if (!account) throw new Error("Tidak ada account Lazada di DB");

        const accessToken = account.access_token.trim();
        const apiKey = process.env.LAZADA_APP_KEY.trim();
        const appSecret = process.env.LAZADA_APP_SECRET.trim();
        const apiPath = "/product/item/get";
        const timestamp = Date.now().toString();

        // === PARAMETER WAJIB ===
        const sysParams = {
            app_key: apiKey,
            access_token: accessToken,
            sign_method: "sha256",
            timestamp,
            v: "1.0",
            item_id,
        };

        // 🔏 Generate Signature
        const sign = generateSign(apiPath, sysParams, appSecret);

        // === URL FINAL ===
        const url = `https://api.lazada.co.id/rest${apiPath}?${new URLSearchParams({
            ...sysParams,
            sign,
        }).toString()}`;

        // 🔁 Request ke Lazada API
        const response = await axios.get(url);

        // ✅ Success
        res.json({
            success: true,
            message: "Data produk berhasil diambil dari Lazada.",
            lazada_response: response.data,
        });
    } catch (err) {
        console.error("❌ Lazada GetProductItem Error:", err.response?.data || err.message);
        res.status(500).json({
            success: false,
            error: err.response?.data || err.message,
            message: "Gagal mengambil data produk dari Lazada.",
        });
    }
};

const updateProductLazada = async (req, res) => {
    try {
        const { id_product } = req.params;
        const { category_id, selected_unit, attributes = {}, update_image = false } = req.body;

        if (!category_id)
            return res.status(400).json({ success: false, message: "category_id wajib dikirim di body" });

        // === Ambil akun Lazada ===
        const account = await Lazada.findOne();
        if (!account) throw new Error("Tidak ada account Lazada di DB");

        const accessToken = account.access_token.trim();
        const apiKey = process.env.LAZADA_APP_KEY.trim();
        const appSecret = process.env.LAZADA_APP_SECRET.trim();
        const apiPath = "/product/update";
        const timestamp = Date.now().toString();

        // === Ambil produk dari DB lokal ===
        const product = await Product.findOne({
            where: { id_product },
            include: [{ model: Stok, as: "stok" }],
        });
        if (!product) throw new Error("Produk tidak ditemukan di database");

        // === Tentukan stok yang dipilih ===
        let stokTerpilih;
        if (selected_unit) {
            stokTerpilih = product.stok.find(s => s.satuan === selected_unit);
            if (!stokTerpilih)
                throw new Error(`Stok untuk satuan "${selected_unit}" tidak ditemukan`);
        } else {
            if (!product.stok || product.stok.length === 0)
                throw new Error("Produk tidak memiliki stok sama sekali");
            stokTerpilih = product.stok[0];
        }

        // === Validasi id_product_lazada & sku_lazada ===
        if (!stokTerpilih.id_product_lazada)
            throw new Error("Produk ini belum punya id_product_lazada di stok");

        if (!stokTerpilih.sku_lazada)
            throw new Error("Produk ini belum punya sku_lazada di stok (sku_id wajib untuk update)");

        // === Upload gambar kalau diminta ===
        let uploadedImageUrl = null;
        if (update_image) {
            uploadedImageUrl = await uploadImageToLazadaFromDB(product, accessToken);
        }

        // === Ambil data produk dari DB + gabungkan dengan input body ===
        const productAttributes = {
            name: product.nama_product,
            brand: attributes.brand || "No Brand",
            description: product.deskripsi_product || "Deskripsi belum tersedia",
            short_description: product.deskripsi_product?.slice(0, 100) || "Short description",
            Net_Weight: attributes.Net_Weight || "500 g",
        };

        // === Gunakan sku_id dari DB ===
        const skuAttributes = {
            SkuId: stokTerpilih.sku_lazada, // ← WAJIB dari DB
            SellerSku: attributes.SellerSku || stokTerpilih.id_stok.toString(),
            quantity: String(stokTerpilih.stok),
            price: String(stokTerpilih.harga),
            package_height: String(attributes.package_height || stokTerpilih.tinggi || 10),
            package_length: String(attributes.package_length || stokTerpilih.panjang || 10),
            package_width: String(attributes.package_width || stokTerpilih.lebar || 10),
            package_weight: String(attributes.package_weight || stokTerpilih.berat || 0.5),
            package_content: `${product.nama_product} - ${attributes.brand || "No Brand"}`,
        };

        // === Buat struktur payload untuk update ===
        const productObj = {
            Request: {
                Product: {
                    PrimaryCategory: category_id,
                    ItemId: stokTerpilih.id_product_lazada,
                    Images: uploadedImageUrl ? { Image: [uploadedImageUrl] } : undefined,
                    Attributes: productAttributes,
                    Skus: { Sku: [skuAttributes] },
                },
            },
        };

        // === Generate signature & URL ===
        const sysParams = { app_key: apiKey, access_token: accessToken, sign_method: "sha256", timestamp, v: "1.0" };
        const jsonBody = JSON.stringify(productObj);
        const sign = generateSign(apiPath, { ...sysParams, payload: jsonBody }, appSecret);
        const url = `https://api.lazada.co.id/rest${apiPath}?${new URLSearchParams({ ...sysParams, sign }).toString()}`;
        const bodyForRequest = new URLSearchParams({ payload: jsonBody });

        // === Kirim request ke Lazada ===
        const response = await axios.post(url, bodyForRequest, {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });

        // === Update data lokal (harga, stok, gambar kalau diubah) ===
        await Stok.update(
            {
                harga: stokTerpilih.harga,
                stok: stokTerpilih.stok,
                ...(uploadedImageUrl ? { last_lazada_image: uploadedImageUrl } : {}),
            },
            { where: { id_stok: stokTerpilih.id_stok } }
        );

        res.json({
            success: true,
            message: "Produk berhasil diupdate ke Lazada.",
            lazada_response: response.data,
            image_used: uploadedImageUrl || "Gambar lama digunakan",
        });

    } catch (err) {
        console.error("❌ Lazada Update Product Error:", err);
        res.status(500).json({
            success: false,
            error: err.response?.data || err.message,
            message: "Gagal update produk di Lazada.",
        });
    }
};

const getCategoryTree = async (req, res) => {
    try {
        const lazadaData = await Lazada.findOne();
        if (!lazadaData?.access_token) return res.status(400).json({ error: "Token Lazada not found" });

        const access_token = lazadaData.access_token;
        const API_PATH = "/category/tree/get";
        const timestamp = String(Date.now());

        const params = { app_key: process.env.LAZADA_APP_KEY, sign_method: "sha256", timestamp, access_token, language_code: "id_ID" };
        params.sign = generateSign(API_PATH, params, process.env.LAZADA_APP_SECRET);

        const url = `https://api.lazada.co.id/rest${API_PATH}?${new URLSearchParams(params).toString()}`;
        const response = await axios.get(url);

        return res.json(response.data);
    } catch (err) {
        console.error("❌ Lazada Get Category Tree Error:", err.response?.data || err.message);
        return res.status(500).json({ error: err.response?.data || err.message });
    }
};

const getBrands = async (req, res) => {
    try {
        const lazadaData = await Lazada.findOne();
        if (!lazadaData?.access_token) return res.status(400).json({ error: "Token Lazada not found" });

        const access_token = lazadaData.access_token;
        const API_PATH = "/category/brands/query";
        const timestamp = String(Date.now());
        const { startRow = 0, pageSize = 50 } = req.query;

        const params = { app_key: process.env.LAZADA_APP_KEY, sign_method: "sha256", timestamp, access_token, startRow, pageSize };
        params.sign = generateSign(API_PATH, params, process.env.LAZADA_APP_SECRET);

        const url = `https://api.lazada.co.id/rest${API_PATH}?${new URLSearchParams(params).toString()}`;
        const response = await axios.get(url);

        return res.json(response.data);
    } catch (err) {
        console.error("❌ Lazada Get Brands Error:", err.response?.data || err.message);
        return res.status(500).json({ error: err.response?.data || err.message });
    }
};

const getLazadaOrders = async (req, res) => {
    try {
        const lazadaAcc = await Lazada.findOne();
        if (!lazadaAcc?.access_token) {
            return res.status(400).json({
                success: false,
                message: "Access token Lazada tidak ditemukan di database",
            });
        }

        const access_token = lazadaAcc.access_token;
        const now = Math.floor(Date.now() / 1000);
        const twoDaysAgo = now - 2 * 24 * 60 * 60;

        // 1️⃣ Ambil daftar order READY_TO_SHIP
        const apiPath = "/orders/get";
        const params = {
            app_key: APP_KEY,
            timestamp: Date.now(),
            access_token,
            status: "ready_to_ship",
            created_after: new Date(twoDaysAgo * 1000).toISOString(),
            created_before: new Date().toISOString(),
        };
        const sign = generateLazadaSign(apiPath, params);
        params.sign = sign;

        const { data: orderListResp } = await axios.get(`${LAZADA_API_URL}${apiPath}`, { params });
        const orders = orderListResp.data?.orders || [];

        if (!orders.length) {
            return res.json({
                success: true,
                message: "Tidak ada order READY_TO_SHIP di Lazada",
                count: 0,
                data: [],
            });
        }

        const finalOrders = [];

        // 2️⃣ Ambil detail item untuk setiap order
        for (const order of orders) {
            const orderId = order.order_id;
            const itemPath = "/order/items/get";
            const itemParams = {
                app_key: APP_KEY,
                timestamp: Date.now(),
                access_token,
                order_id: orderId,
            };
            const itemSign = generateLazadaSign(itemPath, itemParams);
            itemParams.sign = itemSign;

            const { data: itemResp } = await axios.get(`${LAZADA_API_URL}${itemPath}`, {
                params: itemParams,
            });

            const items = itemResp.data?.items || [];
            const mappedItems = [];

            for (const item of items) {
                // Cek stok lokal
                const stok = await db.query(
                    `
                    SELECT 
                        s.id_product_stok,
                        s.id_product_lazada,
                        s.satuan,
                        p.nama_product,
                        p.gambar_product
                    FROM stok s
                    JOIN product p ON p.id_product = s.id_product
                    WHERE s.id_product_lazada = :itemId
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

                    mappedItems.push({
                        item_id: item.item_id,
                        name: item.name,
                        sku: item.sku,
                        quantity: item.quantity,
                        item_price: item.item_price,
                        from_db: true,
                        id_product_stok: local.id_product_stok,
                        satuan: local.satuan,
                        nama_product: local.nama_product,
                        image_url: gambarBase64,
                    });
                } else {
                    mappedItems.push({
                        item_id: item.item_id,
                        name: item.name,
                        sku: item.sku,
                        quantity: item.quantity,
                        item_price: item.item_price,
                        from_db: false,
                    });
                }
            }

            finalOrders.push({
                order_id: order.order_id,
                order_number: order.order_number,
                customer_first_name: order.customer_first_name,
                created_at: order.created_at,
                total_amount: order.price,
                status: order.status,
                items: mappedItems,
            });
        }

        return res.json({
            success: true,
            message: "Berhasil mengambil semua order READY_TO_SHIP dari Lazada + data lokal",
            count: finalOrders.length,
            data: finalOrders,
        });
    } catch (err) {
        console.error("❌ Error getLazadaOrdersWithItems:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil data order Lazada",
            error: err.response?.data || err.message,
        });
    }
};

// ==========================================================
// 🔹 GET DETAIL PESANAN + ITEM DARI TOKO ASLI (PRODUCTION)
// ==========================================================
const getFullOrderDetailLazada = async (req, res) => {
    try {
        const { order_id } = req.query;
        if (!order_id) {
            return res.status(400).json({
                success: false,
                message: "Parameter 'order_id' wajib dikirim di query",
            });
        }

        const lazadaData = await Lazada.findOne();
        if (!lazadaData?.access_token) {
            return res.status(400).json({ success: false, message: "Token Lazada tidak ditemukan di DB" });
        }

        const accessToken = lazadaData.access_token.trim();
        const apiKey = process.env.LAZADA_APP_KEY.trim();
        const appSecret = process.env.LAZADA_APP_SECRET.trim();
        const baseUrl = "https://api.lazada.co.id/rest"; // ✅ toko asli

        // ========== STEP 1: GET ORDER DETAIL ==========
        const apiPathOrder = "/order/get";
        const paramsOrder = {
            app_key: apiKey,
            access_token: accessToken,
            sign_method: "sha256",
            timestamp: Date.now().toString(),
            v: "1.0",
            order_id,
        };

        const signOrder = generateSign(apiPathOrder, paramsOrder, appSecret);
        const urlOrder = `${baseUrl}${apiPathOrder}?${new URLSearchParams({
            ...paramsOrder,
            sign: signOrder,
        }).toString()}`;

        const orderResponse = await axios.get(urlOrder);
        const orderData = orderResponse.data?.data || {};

        // ========== STEP 2: GET ORDER ITEMS ==========
        const apiPathItems = "/order/items/get";
        const paramsItems = {
            app_key: apiKey,
            access_token: accessToken,
            sign_method: "sha256",
            timestamp: Date.now().toString(),
            v: "1.0",
            order_id,
        };

        const signItems = generateSign(apiPathItems, paramsItems, appSecret);
        const urlItems = `${baseUrl}${apiPathItems}?${new URLSearchParams({
            ...paramsItems,
            sign: signItems,
        }).toString()}`;

        const itemsResponse = await axios.get(urlItems);
        const itemsData = itemsResponse.data?.data || [];

        // ✅ Gabungkan hasil
        res.json({
            success: true,
            message: "Berhasil ambil detail pesanan + item dari Lazada (Production)",
            data: {
                order: orderData,
                items: itemsData,
            },
        });
    } catch (err) {
        console.error("❌ Lazada GetFullOrderDetail Error:", err.response?.data || err.message);
        res.status(500).json({
            success: false,
            message: "Gagal mengambil detail lengkap pesanan dari Lazada",
            error: err.response?.data || err.message,
        });
    }
};

module.exports = {
    generateLoginUrl,
    lazadaCallback,
    refreshToken,
    createProductLazada,
    updateProductLazada,
    getCategoryTree,
    getBrands,
    getProducts,
    getCategoryAttributes,
    getAllCategoryAttributes,
    getProductItemLazada,
    getFullOrderDetailLazada,
    getLazadaOrders
};