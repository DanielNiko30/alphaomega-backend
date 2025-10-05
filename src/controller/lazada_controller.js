const axios = require('axios');
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

const getCategoryAttributes = async (req, res) => {
    try {
        const account = await Lazada.findOne();
        if (!account) throw new Error("Tidak ada account Lazada di DB");

        const accessToken = account.access_token.trim();
        const apiKey = (process.env.LAZADA_APP_KEY || "").trim();
        const appSecret = (process.env.LAZADA_APP_SECRET || "").trim();

        const apiPath = "/category/attributes/get";
        const timestamp = Date.now().toString();

        // Kita menggunakan Category ID yang sama (Krimer) untuk mendapatkan daftar atributnya.
        const primaryCategoryId = "17935";

        // 1. System params
        const sysParams = {
            app_key: apiKey,
            access_token: accessToken, // Meskipun opsional di docs, kita tetap kirim token untuk otorisasi
            sign_method: "sha256",
            timestamp,
            v: "1.0"
        };

        // 2. Business params (wajib)
        const businessParams = {
            primary_category_id: primaryCategoryId,
            language_code: "id_ID"
        };

        // 3. Gabungkan SEMUA Parameter (System + Business) untuk SIGNING
        const allParamsForSignAndUrl = {
            ...sysParams,
            ...businessParams
        };

        // 4. Buat SIGNATURE
        const sign = generateSign(apiPath, allParamsForSignAndUrl, appSecret);

        // 5. Build URL query string dengan semua parameter dan signature
        const urlSearchParams = new URLSearchParams({ ...allParamsForSignAndUrl, sign });
        const url = `https://api.lazada.co.id/rest${apiPath}?${urlSearchParams.toString()}`;

        // 6. GET request ke Lazada
        const response = await axios.get(url);

        res.json({
            success: true,
            message: `Berhasil mendapatkan atribut untuk Category ID ${primaryCategoryId}.`,
            request: {
                apiPath,
                url,
                params: allParamsForSignAndUrl
            },
            lazada_response: response.data
        });

    } catch (err) {
        const errorData = err.response?.data || { message: err.message };
        console.error("❌ Lazada Get Attributes Error:", errorData);

        res.status(err.response?.status || 500).json({
            error: errorData,
            statusCode: err.response?.status || 500,
            message: "Permintaan ke Lazada gagal. Cek log error untuk detailnya."
        });
    }
};

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

/**
 * Upload Image to Lazada
 */
const FormData = require("form-data");
const sharp = require("sharp");
const axios = require("axios");
const { Product } = require("../models/product_model");
const { Lazada } = require("../models/lazada_model");
const { generateSign } = require("../utils/lazadaSign");

// --- Fungsi Upload Gambar ke Lazada ---
async function uploadImageToLazadaFromDB(accessToken) {
    try {
        const product = await Product.findByPk("PRO007");
        if (!product || !product.gambar_product) {
            throw new Error("Produk PRO007 tidak ditemukan atau tidak memiliki gambar.");
        }

        console.log("📸 Mengambil gambar dari DB untuk PRO007...");

        // Konversi BLOB → Buffer
        const imgBuffer = Buffer.from(product.gambar_product);

        // Kompres gambar agar efisien
        const optimizedBuffer = await sharp(imgBuffer)
            .resize({ width: 800, withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();

        // Siapkan parameter untuk upload ke Lazada
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

        // Buat FormData dengan buffer gambar
        const form = new FormData();
        form.append("image", optimizedBuffer, {
            filename: "product.jpg",
            contentType: "image/jpeg",
        });

        const headers = form.getHeaders();

        let response;
        try {
            response = await axios.post(url, form, { headers });
        } catch (error) {
            console.error(
                "🛰️ Lazada Upload Response (ERROR):",
                JSON.stringify(error.response?.data || error.message, null, 2)
            );
            throw new Error("Upload gambar ke Lazada gagal: " + (error.response?.data?.message || error.message));
        }

        console.log("🛰️ Lazada Upload Response (SUCCESS):", JSON.stringify(response.data, null, 2));

        // Cek apakah Lazada balas URL
        const imageUrl =
            response.data?.data?.image?.url ||
            response.data?.data?.url ||
            response.data?.data?.full_url ||
            null;

        if (!imageUrl) {
            throw new Error("Gagal upload gambar ke Lazada. Tidak ada URL gambar dalam response.");
        }

        console.log("✅ Gambar berhasil diupload ke Lazada:", imageUrl);
        return imageUrl;
    } catch (err) {
        console.error("❌ Upload Image Error:", err.response?.data || err.message);
        throw new Error("Upload gambar ke Lazada gagal: " + err.message);
    }
}

// --- Create Dummy Product ---
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

        // 3️⃣ Siapkan payload produk
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
                    Images: {
                        Image: [uploadedImageUrl],
                    },
                    Attributes: {
                        name: "TEST-TOTE-BAG-" + uniqueSuffix,
                        brand: "No Brand",
                        description: "Tas Tote Bag Wanita (Canvas) untuk percobaan API Lazada.",
                        short_description: "Tote Bag Kanvas API Test.",
                        material: "28232", // Canvas
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
                                Bag_Size: "58949", // Medium
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

        // 5️⃣ Response ke client
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
 * Create Product Lazada (return step status walaupun error)
 */
async function createProductLazada({ product, stokTerpilih, category_id, brand, seller_sku, accessToken }) {
    // Pakai gambar default, jangan upload
    const imageUrl = "https://via.placeholder.com/800x800.png?text=Default+Image";
    const imageHash = "default_hash"; // optional, kalau Lazada perlu

    const builder = new Builder({ cdata: true, headless: true });
    const payloadObj = {
        Request: {
            Product: {
                PrimaryCategory: category_id,
                Attributes: {
                    name: product.nama_product,
                    short_description: `<p>${product.deskripsi || "Tidak ada deskripsi"}</p>`,
                    brand,
                    package_content: `${product.nama_product} - ${brand}`,
                    model: seller_sku,
                    warranty_type: "No Warranty",
                    hazmat: "None",
                    delivery_option_sop: "0",
                    product_warranty: "false",
                    net_weight: stokTerpilih.berat || 0.5
                },
                Skus: {
                    Sku: {
                        SellerSku: seller_sku,
                        quantity: stokTerpilih.qty || 1,
                        price: stokTerpilih.harga_jual || 1000,
                        package_length: stokTerpilih.panjang || 10,
                        package_width: stokTerpilih.lebar || 10,
                        package_height: stokTerpilih.tinggi || 10,
                        package_weight: stokTerpilih.berat || 0.5
                    }
                },
                Images: { Image: { url: imageUrl, hash_code: imageHash } }
            }
        }
    };
    const payloadXML = builder.buildObject(payloadObj);

    let productResult = null;
    try {
        const API_PATH = "/product/create";
        const timestamp = Date.now().toString();
        const sysParams = {
            app_key: process.env.LAZADA_APP_KEY,
            access_token: accessToken,
            sign_method: "sha256",
            timestamp
        };
        const sign = generateSign(API_PATH, sysParams, process.env.LAZADA_APP_SECRET, payloadXML);
        const url = `https://api.lazada.co.id/rest${API_PATH}?${new URLSearchParams({ ...sysParams, sign }).toString()}`;
        const body = `payload=${encodeURIComponent(payloadXML)}`;

        const res = await axios.post(url, body, {
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
            timeout: 30000
        });

        productResult = { success: true, data: res.data };
    } catch (err) {
        console.error("❌ Create Product Error:", err.code || err.message, err.response?.data || null);
        productResult = { success: false, message: err.message || err.code, responseData: err.response?.data || null };
    }

    return { productResult, imageUsed: imageUrl };
}

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