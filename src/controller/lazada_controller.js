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
 * Fungsi untuk menghasilkan tanda tangan (signature) API Lazada.
 * Menggunakan HMAC SHA256 dengan App Secret sebagai kunci.
* @param {string} apiPath - Path API (e.g., "/product/create")
 * @param {Object<string, string>} allParams - Semua parameter (sysParams + payload dengan nilai MENTAH JSON)
 * @param {string} appSecret - App Secret Lazada (kunci untuk HMAC)
 * @returns {string} Signature dalam format Hex Uppercase
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
 * Controller untuk membuat dummy product
 * @param {*} req 
 * @param {*} res 
 */
/**
 * Generate Login URL Lazada
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

/**
 * Callback setelah login Lazada
 */
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

/**
 * Refresh Access Token Lazada
 */
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

/**
 * Get Products
 */
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
        const allParamsForSign = {
            ...sysParams,
            ...businessParams,
        };

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

        // 🔹 Filter atribut wajib (is_mandatory / key_prop / sale_prop)
        const requiredAttributes = attributes
            .filter(attr =>
                attr.is_mandatory === 1 ||
                attr.advanced?.is_key_prop === 1 ||
                attr.is_sale_prop === 1
            )
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

        // 🔹 Return ke frontend
        res.json({
            success: true,
            message: `Berhasil mendapatkan ${requiredAttributes.length} atribut wajib untuk Category ID ${primaryCategoryId}.`,
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

// --- Fungsi Upload Gambar ke Lazada ---
async function uploadImageToLazadaFromDB(product, accessToken) {
    try {
        if (!product || !product.gambar_product) {
            throw new Error("Produk tidak ditemukan atau tidak memiliki gambar.");
        }

        console.log(`📸 Mengambil gambar dari DB untuk ${product.id_product}...`);

        const imgBuffer = Buffer.from(product.gambar_product);

        // Pastikan ukuran minimal 400x400
        const metadata = await sharp(imgBuffer).metadata();
        const resizeWidth = Math.max(metadata.width || 400, 400);
        const resizeHeight = Math.max(metadata.height || 400, 400);

        const optimizedBuffer = await sharp(imgBuffer)
            .resize({ width: resizeWidth, height: resizeHeight, fit: "cover" })
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
        const url = `https://api.lazada.co.id/rest${API_PATH}?${new URLSearchParams({
            ...params,
            sign,
        }).toString()}`;

        const form = new FormData();
        form.append("image", fs.createReadStream(tempPath), {
            filename: `${product.id_product}.jpg`,
            contentType: "image/jpeg",
        });

        console.log("🛰️ Uploading image to Lazada...");
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

        if (!imageUrl) {
            console.error("❌ Upload Image Error (no URL):", response.data);
            throw new Error("Gagal upload gambar ke Lazada. Tidak ada URL gambar dalam response.");
        }

        console.log("✅ Gambar berhasil diupload ke Lazada:", imageUrl);
        return imageUrl;
    } catch (err) {
        console.error("❌ Upload Image Error:", err.response?.data || err.message);
        throw new Error("Upload gambar ke Lazada gagal: " + err.message);
    }
}

// 🔹 Fungsi utama untuk create product
const createProductLazada = async (req, res) => {
    try {
        const { id_product } = req.params;
        const { category_id, selected_unit, attributes = {} } = req.body;
        // attributes = { dietary_needs: [...], Net_Weight: 100, flavor: "Kelapa", SellerSku: "SKU123", price: 10000, ... }

        // 1️⃣ Ambil akun Lazada
        const account = await Lazada.findOne();
        if (!account) throw new Error("Tidak ada account Lazada di DB");

        const accessToken = account.access_token.trim();
        const apiKey = process.env.LAZADA_APP_KEY.trim();
        const appSecret = process.env.LAZADA_APP_SECRET.trim();
        const apiPath = "/product/create";
        const timestamp = Date.now().toString();

        // 2️⃣ Ambil data produk + stok
        const product = await Product.findOne({
            where: { id_product },
            include: [{ model: Stok, as: "stok" }],
        });
        if (!product) throw new Error("Produk tidak ditemukan di database");

        const stokTerpilih = selected_unit
            ? product.stok.find((s) => s.satuan === selected_unit)
            : product.stok[0];
        if (!stokTerpilih) throw new Error("Stok untuk satuan tersebut tidak ditemukan");

        // 3️⃣ Upload gambar
        const uploadedImageUrl = await uploadImageToLazadaFromDB(product, accessToken);

        // 4️⃣ Ambil atribut wajib dari category_id
        const requiredAttributes = await getCategoryAttributes(category_id);
        // contoh output: [{name: "dietary_needs"}, {name: "Net_Weight"}, {name: "flavor"}, ...]

        // 5️⃣ Mapping attributes
        const attributesObj = {
            name: product.nama_product,
            brand: attributes.brand || "No Brand",
            description: attributes.description || product.deskripsi_product || "Deskripsi belum tersedia",
            short_description: attributes.short_description || product.deskripsi_product || "Deskripsi belum tersedia",
        };

        // ✅ Merge semua atribut wajib dari req.body
        for (const attr of requiredAttributes) {
            const key = attr.name;
            if (!(key in attributes)) {
                throw new Error(`Atribut wajib "${key}" belum dikirim di body.attributes`);
            }
            attributesObj[key] = attributes[key];
        }

        // 6️⃣ Payload produk + SKU
        const productObj = {
            Request: {
                Product: {
                    PrimaryCategory: category_id,
                    Images: { Image: [uploadedImageUrl] },
                    Attributes: attributesObj,
                    Skus: {
                        Sku: [
                            {
                                SellerSku: attributes.SellerSku || stokTerpilih.id_stok,
                                quantity: stokTerpilih.stok,
                                price: attributes.price || stokTerpilih.harga_jual || 1000,
                                package_height: attributes.package_height || stokTerpilih.tinggi || 10,
                                package_length: attributes.package_length || stokTerpilih.panjang || 10,
                                package_width: attributes.package_width || stokTerpilih.lebar || 10,
                                package_weight: attributes.package_weight || stokTerpilih.berat || 0.5,
                                package_content: `${product.nama_product} - ${attributes.brand || "No Brand"}`,
                            },
                        ],
                    },
                },
            },
        };

        // 7️⃣ Signing
        const sysParams = {
            app_key: apiKey,
            access_token: accessToken,
            sign_method: "sha256",
            timestamp,
            v: "1.0",
        };
        const jsonBody = JSON.stringify(productObj);
        const allParamsForSign = { ...sysParams, payload: jsonBody };
        const sign = generateSign(apiPath, allParamsForSign, appSecret);

        // 8️⃣ Kirim request ke Lazada
        const url = `https://api.lazada.co.id/rest${apiPath}?${new URLSearchParams({
            ...sysParams,
            sign,
        }).toString()}`;
        const bodyForRequest = new URLSearchParams({ payload: jsonBody });

        const response = await axios.post(url, bodyForRequest, {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });

        res.json({
            success: true,
            message: "Produk berhasil ditambahkan ke Lazada.",
            image_used: uploadedImageUrl,
            request: { apiPath, sysParams, sign, url, bodyStrForRequest: bodyForRequest.toString() },
            lazada_response: response.data,
        });
    } catch (err) {
        console.error("❌ Lazada Create Product Error:", err);

        let statusCode = 500;
        let errorData = err.message;

        if (err.response) {
            statusCode = err.response.status;
            errorData = err.response.data;
        } else if (err.request) {
            errorData = "No response received from Lazada API";
        }

        res.status(statusCode).json({
            success: false,
            error: errorData,
            message: "Gagal membuat produk di Lazada.",
        });
    }
};


const createDummyProduct = async (req, res) => {
    try {
        // 1️⃣ Ambil akun Lazada
        const account = await Lazada.findOne();
        if (!account) throw new Error("Tidak ada account Lazada di DB");

        const accessToken = account.access_token.trim();
        const apiKey = process.env.LAZADA_APP_KEY.trim();
        const appSecret = process.env.LAZADA_APP_SECRET.trim();

        const apiPath = "/product/create";
        const timestamp = Date.now().toString();
        const uniqueSuffix = Date.now().toString().slice(-6);

        // 2️⃣ Upload gambar dari DB PRO007
        const uploadedImageUrl = await uploadImageToLazadaFromDB(accessToken);
        console.log("✅ Uploaded Image URL:", uploadedImageUrl);

        // 3️⃣ Payload produk
        const sysParams = {
            app_key: apiKey,
            access_token: accessToken,
            sign_method: "sha256",
            timestamp,
            v: "1.0",
        };

        const productObj = {
            Request: {
                Product: {
                    PrimaryCategory: "17935", // Tote Bag Wanita
                    Images: { Image: [uploadedImageUrl] },
                    Attributes: {
                        name: "TEST-TOTE-BAG-" + uniqueSuffix,
                        brand: "No Brand",
                        description: "Tas Tote Bag Wanita (Canvas) untuk percobaan API Lazada.",
                        short_description: "Tote Bag Kanvas API Test.",
                        material: "28232",
                    },
                    Skus: {
                        Sku: [
                            {
                                SellerSku: "SKU-TOTE-" + uniqueSuffix,
                                quantity: 3,
                                price: 1000,
                                package_height: 3,
                                package_length: 35,
                                package_width: 30,
                                package_weight: 0.2,
                                package_content: "1x Tote Bag Wanita",
                                Bag_Size: "58949",
                            },
                        ],
                    },
                },
            },
        };

        // 4️⃣ Signing & Request
        const jsonBody = JSON.stringify(productObj);
        const allParamsForSign = { ...sysParams, payload: jsonBody };
        const sign = generateSign(apiPath, allParamsForSign, appSecret);

        const url = `https://api.lazada.co.id/rest${apiPath}?${new URLSearchParams({
            ...sysParams,
            sign,
        }).toString()}`;

        const bodyForRequest = new URLSearchParams({ payload: jsonBody });

        const response = await axios.post(url, bodyForRequest, {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });

        res.json({
            success: true,
            message: "Produk dummy berhasil dibuat menggunakan gambar dari PRO007.",
            image_used: uploadedImageUrl,
            request: {
                apiPath,
                sysParams,
                sign,
                url,
                bodyStrForRequest: bodyForRequest.toString(),
            },
            lazada_response: response.data,
        });
    } catch (err) {
        console.error("❌ Create Dummy Product Error:", err);
        res.status(500).json({
            error: { message: err.message },
            message: "Gagal membuat produk dummy dari BLOB.",
        });
    }
};

/**
 * Update Product Lazada
 */
const updateProductLazada = async (req, res) => {
    try {
        const { id_product } = req.params;
        const { brand, seller_sku, price, quantity, selected_unit } = req.body;

        let lazadaData = await Lazada.findOne();
        if (!lazadaData?.access_token) return res.status(400).json({ error: "Lazada token not found" });

        const now = Math.floor(Date.now() / 1000);
        if (lazadaData.expires_in + lazadaData.last_updated - now < 60) {
            lazadaData.access_token = await refreshToken();
        }
        const access_token = lazadaData.access_token;

        const product = await Product.findOne({ where: { id_product }, include: [{ model: Stok, as: "stok" }] });
        if (!product) return res.status(404).json({ error: "Produk tidak ditemukan" });

        const stokTerpilih = selected_unit ? product.stok.find(s => s.satuan === selected_unit) : product.stok[0];
        if (!stokTerpilih?.id_product_lazada) return res.status(400).json({ error: "Produk ini belum punya id_product_lazada" });

        const payload = `
<Request>
  <Product>
    <Skus>
      <Sku>
        <SellerSku>${seller_sku || stokTerpilih.id_stok}</SellerSku>
        <quantity>${quantity || stokTerpilih.stok}</quantity>
        <price>${price || stokTerpilih.harga}</price>
      </Sku>
    </Skus>
  </Product>
</Request>`.trim();

        const apiPath = "/product/update";
        const timestamp = String(Date.now());
        const params = { app_key: process.env.LAZADA_APP_KEY, sign_method: "sha256", access_token, timestamp };
        const sign = generateSign(apiPath, params, process.env.LAZADA_APP_SECRET, payload);
        const url = `https://api.lazada.co.id/rest${apiPath}?${new URLSearchParams({ ...params, sign })}`;

        const updateResponse = await axios.post(url, `payload=${encodeURIComponent(payload)}`, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });

        return res.status(200).json({ success: true, message: "Produk berhasil diupdate di Lazada", lazada_response: updateResponse.data });
    } catch (err) {
        console.error("❌ Lazada Update Product Error:", err.response?.data || err.message);
        return res.status(500).json({ error: err.response?.data || err.message, message: "Gagal update produk di Lazada." });
    }
};

/**
 * Get Category Tree
 */
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

/**
 * Get Brands
 */
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

module.exports = {
    generateLoginUrl,
    lazadaCallback,
    refreshToken,
    createProductLazada,
    updateProductLazada,
    getCategoryTree,
    getBrands,
    getProducts,
    createDummyProduct,
    getCategoryAttributes
};