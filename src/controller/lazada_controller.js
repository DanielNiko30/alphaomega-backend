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
 * Generate Lazada API signature
 * @param {string} apiPath - Contoh: "/product/create"
 * @param {object} params - query params: app_key, access_token, sign_method, timestamp
 * @param {string} appSecret - secret key
 * @param {string} bodyStr - JSON string body
 * @returns {string} signature uppercase
 */
// function generateSign(apiPath, params, appSecret, body = "") {
//     // 1. sort params by ASCII
//     const keys = Object.keys(params).sort();
//     let strToSign = apiPath;

//     // 2. concat key + value
//     for (const key of keys) {
//         const val = params[key];
//         if (val !== undefined && val !== null && val !== "") {
//             strToSign += key + val;
//         }
//     }

//     // 3. concat raw body if ada
//     if (body) strToSign += body;

//     // 4. HMAC-SHA256
//     const hmac = crypto.createHmac("sha256", appSecret);
//     hmac.update(strToSign, "utf8");
//     return hmac.digest("hex").toUpperCase();
// }

function generateSign(apiPath, params, appSecret, bodyStr = "") {
    // Urutkan key alphabetically
    const sortedKeys = Object.keys(params).sort();
    let baseStr = apiPath;
    for (const key of sortedKeys) {
        baseStr += key + params[key];
    }
    baseStr += bodyStr; // body harus sama persis dengan yang dikirim
    return crypto.createHmac("sha256", appSecret).update(baseStr).digest("hex").toUpperCase();
}

const createDummyProduct = async (req, res) => {
    try {
        // Ambil account Lazada pertama dari DB
        const account = await Lazada.findOne();
        if (!account) throw new Error("Tidak ada account Lazada di DB");

        const accessToken = account.access_token;
        const apiPath = "/product/create";

        // Timestamp 13-digit
        const timestamp = Date.now().toString();

        // System params
        const sysParams = {
            app_key: process.env.LAZADA_APP_KEY,
            access_token: accessToken,
            sign_method: "sha256",
            timestamp
        };

        // Dummy product
        const productObj = {
            Product: {
                PrimaryCategory: "18469",
                Attributes: {
                    name: "Dummy Product Node",
                    short_description: "<p>Ini product dummy untuk test</p>",
                    brand: "No Brand",
                    model: "SKU-12345",
                    warranty_type: "No Warranty",
                    product_warranty: "false",
                    net_weight: 1.2
                },
                Skus: [
                    {
                        SellerSku: "SKU-12345",
                        quantity: 1,
                        price: 1000,
                        package_length: 20,
                        package_width: 15,
                        package_height: 10,
                        package_weight: 1.2
                    }
                ],
                Images: ["https://via.placeholder.com/800x800.png?text=Dummy+Image"]
            }
        };

        // Encode body untuk signature
        const bodyStr = `payload=${encodeURIComponent(JSON.stringify(productObj))}`;

        // Generate signature
        const sign = generateSign(apiPath, sysParams, process.env.LAZADA_APP_SECRET, bodyStr);

        // Build URL query params
        const url = `https://api.lazada.co.id/rest${apiPath}?${new URLSearchParams({ ...sysParams, sign }).toString()}`;

        // Axios POST request
        const response = await axios.post(url, bodyStr, {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
            }
        });

        // Return semua info untuk debugging
        return res.json({
            success: true,
            request: {
                apiPath,
                sysParams,
                sign,
                url,
                bodyStr
            },
            lazada_response: response.data
        });
    } catch (err) {
        console.error("❌ Lazada Create Product Error:", err.response?.data || err.message);
        return res.status(500).json({ error: err.response?.data || err.message });
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
async function uploadImageToLazada(base64Image, accessToken) {
    try {
        const API_PATH = "/image/upload";
        const timestamp = Date.now().toString();
        const imgBuffer = Buffer.from(base64Image, "base64");
        const optimizedBuffer = await sharp(imgBuffer)
            .resize({ width: 800, withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();

        const params = {
            access_token: accessToken,
            app_key: process.env.LAZADA_APP_KEY,
            sign_method: "sha256",
            timestamp,
        };

        const sign = generateSign(API_PATH, params, process.env.LAZADA_APP_SECRET);
        const url = `https://api.lazada.co.id/rest${API_PATH}?${new URLSearchParams({ ...params, sign }).toString()}`;

        const form = new FormData();
        form.append("image", optimizedBuffer, { filename: "product.jpg" });

        const response = await axios.post(url, form, { headers: form.getHeaders() });
        if (!response.data?.data?.image?.url) {
            return { success: false, message: "Gagal upload gambar ke Lazada", responseData: response.data };
        }

        return { success: true, image: response.data.data.image };
    } catch (err) {
        console.error("❌ Upload Image Error:", err.response?.data || err.message);
        return { success: false, message: err.message, responseData: err.response?.data || null };
    }
}


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

const testLazadaIP = async (req, res) => {
    try {
        const lazadaData = await Lazada.findOne();
        if (!lazadaData?.access_token) return res.status(400).json({ error: "Token Lazada not found" });

        const access_token = lazadaData.access_token;
        const API_PATH = "/system/getIPWhitelistStatus"; // endpoint Lazada untuk cek IP
        const timestamp = String(Date.now());

        const params = {
            app_key: process.env.LAZADA_APP_KEY,
            sign_method: "sha256",
            timestamp,
            access_token
        };

        // Generate signature
        params.sign = generateSign(API_PATH, params, process.env.LAZADA_APP_SECRET);

        const url = `https://api.lazada.co.id/rest${API_PATH}?${new URLSearchParams(params).toString()}`;
        const response = await axios.get(url);

        return res.json({
            success: true,
            data: response.data
        });
    } catch (err) {
        console.error("❌ Lazada IP Test Error:", err.response?.data || err.message);
        return res.status(500).json({
            error: err.response?.data || err.message
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
    createDummyProduct,
};