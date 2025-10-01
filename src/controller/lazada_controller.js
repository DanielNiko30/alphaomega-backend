const axios = require('axios');
const crypto = require('crypto');
const { Lazada } = require('../model/lazada_model');
const { Product } = require('../model/product_model');
const { Stok } = require('../model/stok_model');
const FormData = require("form-data");
const { Builder } = require("xml2js");

/**
 * Helper: Generate Lazada Signature
 */
function generateSign(apiPath, params, appSecret) {
    const crypto = require("crypto");

    // Sort params alphabetically
    const sortedKeys = Object.keys(params).sort();
    let canonicalized = apiPath;
    sortedKeys.forEach((key) => {
        canonicalized += key + params[key];
    });

    // HMAC-SHA256
    return crypto
        .createHmac("sha256", appSecret)
        .update(canonicalized)
        .digest("hex")
        .toUpperCase();
}

/**
 * Generate Login URL Lazada
 */
const generateLoginUrl = (req, res) => {
    try {
        const CLIENT_ID = process.env.LAZADA_APP_KEY;
        const REDIRECT_URI = encodeURIComponent('https://tokalphaomegaploso.my.id/api/lazada/callback');
        const state = Math.random().toString(36).substring(2, 15); // random string
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

const getProducts = async (req, res) => {
    try {
        // Ambil token dari DB
        const lazadaData = await Lazada.findOne();
        if (!lazadaData?.access_token) {
            return res.status(400).json({ error: "Token Lazada not found" });
        }

        const access_token = lazadaData.access_token;
        const API_PATH = "/products/get";
        const timestamp = String(Date.now());

        // Ambil query dari user (optional)
        const { filter = "all", limit = 10 } = req.query;

        const params = {
            app_key: process.env.LAZADA_APP_KEY,
            sign_method: "sha256",
            timestamp,
            access_token,
            filter,
            limit
        };

        // Generate sign
        params.sign = generateSign(API_PATH, params, process.env.LAZADA_APP_SECRET);

        // Buat URL final
        const url = `https://api.lazada.co.id/rest${API_PATH}?${new URLSearchParams(params).toString()}`;

        // Request ke Lazada
        const response = await axios.get(url);

        return res.json(response.data);
    } catch (err) {
        console.error("❌ Lazada Get Products Error:", err.response?.data || err.message);
        return res.status(500).json({ error: err.response?.data || err.message });
    }
};

// === UPLOAD IMAGE ===
async function uploadImageToLazada(base64Image) {
    const lazadaData = await Lazada.findOne();
    if (!lazadaData?.access_token) throw new Error("Token Lazada tidak ditemukan");

    const API_PATH = "/image/upload";
    const timestamp = Date.now().toString();

    const params = {
        access_token: lazadaData.access_token,
        app_key: process.env.LAZADA_APP_KEY,
        sign_method: "sha256",
        timestamp
    };
    const sign = generateSign(API_PATH, params, process.env.LAZADA_APP_SECRET);

    const queryString = new URLSearchParams({ ...params, sign }).toString();
    const url = `https://api.lazada.co.id/rest${API_PATH}?${queryString}`;

    const form = new FormData();
    form.append("image", Buffer.from(base64Image, "base64"), { filename: "product.jpg" });

    const response = await axios.post(url, form, { headers: form.getHeaders() });

    if (!response.data?.data?.image?.url) {
        throw {
            message: "Gagal upload gambar ke Lazada",
            responseData: response.data
        };
    }

    return response.data.data.image;
}

/**
 * Create Product Lazada
 */
const createProductLazada = async (req, res) => {
    try {
        const { id_product } = req.params;
        const {
            category_id,
            brand = "No Brand",
            seller_sku,
            selected_unit
        } = req.body;

        // === Ambil token Lazada ===
        const lazadaData = await Lazada.findOne();
        if (!lazadaData?.access_token) {
            return res.status(400).json({ error: "Lazada token not found. Please authorize first." });
        }
        const { access_token } = lazadaData;

        // === Ambil produk lokal ===
        const product = await Product.findOne({
            where: { id_product },
            include: [{ model: Stok, as: "stok" }],
        });
        if (!product) return res.status(404).json({ error: "Produk tidak ditemukan" });

        // === Cek stok & satuan ===
        const stokTerpilih = selected_unit
            ? product.stok.find((s) => s.satuan === selected_unit)
            : product.stok[0];
        if (!stokTerpilih) {
            return res.status(400).json({ error: `Stok untuk satuan ${selected_unit} tidak ditemukan` });
        }

        // === Upload gambar ke Lazada dulu ===
        if (!product.gambar_product) {
            return res.status(400).json({ error: "Produk tidak memiliki gambar!" });
        }
        const imageUrl = await uploadImageToLazada(product.gambar_product, access_token);

        // === Konversi JSON ke XML (pakai xml2js Builder) ===
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
                        net_weight: stokTerpilih.berat || 0.5,
                    },
                    Skus: {
                        Sku: {
                            SellerSku: seller_sku,
                            quantity: stokTerpilih.qty,
                            price: stokTerpilih.harga_jual,
                            package_length: stokTerpilih.panjang || 10,
                            package_width: stokTerpilih.lebar || 10,
                            package_height: stokTerpilih.tinggi || 10,
                            package_weight: stokTerpilih.berat || 0.5,
                        },
                    },
                    Images: {
                        Image: imageUrl,
                    },
                },
            },
        };

        const payload = builder.buildObject(payloadObj);

        // === Signing ===
        const apiPath = "/product/create";
        const timestamp = String(Date.now());
        const signParams = {
            access_token,
            app_key: process.env.LAZADA_APP_KEY,
            sign_method: "sha256",
            timestamp,
        };
        const sign = generateSign(apiPath, signParams, process.env.LAZADA_APP_SECRET);
        const queryString = new URLSearchParams({ ...signParams, sign }).toString();
        const url = `https://api.lazada.co.id/rest${apiPath}?${queryString}`;

        // === Request ke Lazada ===
        const body = new URLSearchParams({ payload }).toString();

        console.log("📦 Lazada Create Product Request:", { url, payload });

        const response = await axios.post(url, body, {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });

        console.log("✅ Lazada Response:", response.data);

        // === Update stok dengan item_id dari Lazada ===
        const itemId = response.data?.data?.item_id;
        if (itemId) {
            await Stok.update(
                { id_product_lazada: itemId },
                { where: { id_stok: stokTerpilih.id_stok } }
            );
        }

        return res.status(201).json({
            success: true,
            message: "Produk berhasil ditambahkan ke Lazada",
            lazada_response: response.data,
        });
    } catch (err) {
        console.error("❌ Lazada Create Product Error:", err.response?.data || err.message);
        return res.status(500).json({
            error: err.response?.data || err.message,
            message: "Gagal menambahkan produk ke Lazada.",
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
        const sign = generateSign(apiPath, params, process.env.LAZADA_APP_SECRET);
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
    getProducts
};
