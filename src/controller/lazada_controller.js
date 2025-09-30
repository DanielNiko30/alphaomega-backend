const axios = require('axios');
const crypto = require('crypto');
const { Lazada } = require('../model/lazada_model');
const { Product } = require('../model/product_model');
const { Stok } = require('../model/stok_model');

/**
 * Helper: Generate Lazada Signature
 */
function generateSign(apiPath, params, appSecret) {
    const sortedKeys = Object.keys(params).sort();
    const baseString = apiPath + sortedKeys.map(k => `${k}${String(params[k])}`).join("");
    return crypto
        .createHmac("sha256", appSecret)
        .update(baseString)
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

        if (!code) {
            return res.status(400).json({ error: "Missing code from Lazada callback" });
        }

        const CLIENT_ID = process.env.LAZADA_APP_KEY;
        const CLIENT_SECRET = process.env.LAZADA_APP_SECRET;
        const API_PATH = "/auth/token/create";
        const TIMESTAMP = Date.now(); // Lazada pakai milidetik

        const params = {
            app_key: CLIENT_ID,
            code: code,
            sign_method: "sha256",
            timestamp: TIMESTAMP,
        };

        const sign = generateSign(API_PATH, params, CLIENT_SECRET);
        params.sign = sign;

        const url = `https://api.lazada.com/rest${API_PATH}`;
        const response = await axios.post(url, new URLSearchParams(params), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const tokenData = response.data;

        if (!tokenData.access_token) {
            return res.status(400).json({ error: "Invalid token response from Lazada", data: tokenData });
        }

        await Lazada.destroy({ where: {} }); // hapus token lama
        await Lazada.create({
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            account: tokenData.account,
            expires_in: tokenData.expires_in,
            last_updated: Math.floor(Date.now() / 1000)
        });

        return res.json({
            success: true,
            state,
            tokenData
        });
    } catch (err) {
        console.error("Lazada Callback Error:", err.response?.data || err.message);
        return res.status(500).json({ error: err.response?.data || err.message });
    }
};

/**
 * Refresh Access Token Lazada
 */
const refreshToken = async (req, res) => {
    try {
        const CLIENT_ID = process.env.LAZADA_APP_KEY;
        const CLIENT_SECRET = process.env.LAZADA_APP_SECRET;
        const API_PATH = "/auth/token/refresh";
        const TIMESTAMP = Date.now();

        const lazadaData = await Lazada.findOne();
        if (!lazadaData) {
            return res.status(404).json({ error: "Lazada token not found in database" });
        }

        const params = {
            app_key: CLIENT_ID,
            refresh_token: lazadaData.refresh_token,
            sign_method: "sha256",
            timestamp: TIMESTAMP
        };

        const sign = generateSign(API_PATH, params, CLIENT_SECRET);
        params.sign = sign;

        const url = `https://api.lazada.com/rest${API_PATH}`;
        const response = await axios.post(url, new URLSearchParams(params), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const tokenData = response.data;

        if (tokenData.access_token) {
            await lazadaData.update({
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token || lazadaData.refresh_token,
                expires_in: tokenData.expires_in,
                last_updated: Math.floor(Date.now() / 1000)
            });

            console.log(`🔄 Lazada token refreshed for account: ${lazadaData.account}`);
        } else {
            return res.status(500).json({ error: "Failed to refresh token", data: tokenData });
        }

        return res.json({
            success: true,
            tokenData
        });
    } catch (err) {
        console.error("Lazada Refresh Token Error:", err.response?.data || err.message);
        return res.status(500).json({ error: err.response?.data || err.message });
    }
};

/**
 * Create Product Lazada
 */
const createProductLazada = async (req, res) => {
    try {
        const { id_product } = req.params;
        const { category_id, brand_name, item_sku, selected_unit, dimension, weight } = req.body;

        // 1️⃣ Ambil token Lazada
        const lazadaData = await Lazada.findOne();
        if (!lazadaData?.access_token)
            return res.status(400).json({ error: "Token Lazada tidak ditemukan" });
        const { access_token } = lazadaData;

        // 2️⃣ Ambil product lokal + stok
        const product = await Product.findOne({
            where: { id_product },
            include: [{ model: Stok, as: "stok" }]
        });
        if (!product) return res.status(404).json({ error: "Produk tidak ditemukan" });
        if (!product.gambar_product) return res.status(400).json({ error: "Produk tidak memiliki gambar!" });

        const stokTerpilih = selected_unit
            ? product.stok.find(s => s.satuan === selected_unit)
            : product.stok[0];
        if (!stokTerpilih)
            return res.status(400).json({ error: `Stok untuk satuan ${selected_unit} tidak ditemukan` });

        // 3️⃣ Buat payload XML
        const payload = `
<Request>
  <Product>
    <PrimaryCategory>${category_id}</PrimaryCategory>
    <Attributes>
      <name><![CDATA[${product.nama_product || "Produk Tanpa Nama"}]]></name>
      <short_description><![CDATA[<p>${product.deskripsi_product || "Deskripsi tidak tersedia"}</p>]]></short_description>
      <brand>${brand_name || "No Brand"}</brand>
      <net_weight>${Number(weight) || 1}</net_weight>
    </Attributes>
    <Skus>
      <Sku>
        <SellerSku>${item_sku || `SKU-${product.id_product}`}</SellerSku>
        <quantity>${stokTerpilih.stok}</quantity>
        <price>${stokTerpilih.harga}</price>
        <package_length>${dimension?.length || 10}</package_length>
        <package_width>${dimension?.width || 10}</package_width>
        <package_height>${dimension?.height || 10}</package_height>
        <package_weight>${Number(weight) || 1}</package_weight>
      </Sku>
    </Skus>
    <Images>
      <Image>${product.gambar_product}</Image>
    </Images>
  </Product>
</Request>`.trim();

        // 4️⃣ Timestamp UTC (detik) — penting untuk Lazada
        const timestamp = Math.floor(Date.now() / 1000);

        // 5️⃣ Prepare sign params (alphabetical order)
        const signParams = {
            access_token,
            app_key: process.env.LAZADA_APP_KEY,
            sign_method: "sha256",
            timestamp
        };

        // 6️⃣ Generate signature
        const sign = generateSign("/product/create", signParams, process.env.LAZADA_APP_SECRET);

        // 7️⃣ URL final
        const queryString = new URLSearchParams({ ...signParams, sign }).toString();
        const url = `https://api.lazada.co.id/rest/product/create?${queryString}`;

        // 8️⃣ Body HARUS form-urlencoded
        const body = `payload=${encodeURIComponent(payload)}`;

        // 9️⃣ POST request ke Lazada
        const response = await axios.post(url, body, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });

        // 1️⃣0️⃣ Update stok lokal jika berhasil
        const itemId = response.data?.data?.item_id;
        if (itemId) await Stok.update({ id_product_lazada: itemId }, { where: { id_stok: stokTerpilih.id_stok } });

        return res.status(201).json({
            success: true,
            message: "Produk berhasil ditambahkan ke Lazada",
            lazada_response: {
                type: response.data.type,
                code: response.data.code,
                message: response.data.message,
                request_id: response.data.request_id
            },
            updated_stock: {
                id_stok: stokTerpilih.id_stok,
                satuan: stokTerpilih.satuan,
                id_product_lazada: itemId || null
            }
        });

    } catch (err) {
        return res.status(500).json({
            error: err.response?.data || err.message,
            message: "Gagal menambahkan produk ke Lazada."
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

        const lazadaData = await Lazada.findOne();
        if (!lazadaData?.access_token) {
            return res.status(400).json({ error: "Lazada token not found. Please authorize first." });
        }
        const { access_token } = lazadaData;

        const product = await Product.findOne({
            where: { id_product },
            include: [{ model: Stok, as: "stok" }]
        });
        if (!product) return res.status(404).json({ error: "Produk tidak ditemukan" });

        const stokTerpilih = selected_unit
            ? product.stok.find(s => s.satuan === selected_unit)
            : product.stok[0];
        if (!stokTerpilih?.id_product_lazada) {
            return res.status(400).json({ error: "Produk ini belum punya id_product_lazada, silakan create dulu" });
        }

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
        </Request>`;

        const apiPath = "/product/update";
        const timestamp = Date.now();
        const params = {
            app_key: process.env.LAZADA_APP_KEY,
            sign_method: "sha256",
            access_token,
            timestamp
        };
        const sign = generateSign(apiPath, params, process.env.LAZADA_APP_SECRET);
        params.sign = sign;

        const url = `https://api.lazada.co.id/rest${apiPath}?${new URLSearchParams(params)}`;

        const updateResponse = await axios.post(url, `payload=${encodeURIComponent(payload)}`, {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });

        return res.status(200).json({
            success: true,
            message: "Produk berhasil diupdate di Lazada",
            lazada_response: updateResponse.data
        });

    } catch (err) {
        console.error("❌ Lazada Update Product Error:", err.response?.data || err.message);
        return res.status(500).json({ error: err.response?.data || err.message, message: "Gagal update produk di Lazada." });
    }
};

const getCategoryTree = async (req, res) => {
    try {
        const CLIENT_ID = process.env.LAZADA_APP_KEY;
        const CLIENT_SECRET = process.env.LAZADA_APP_SECRET;
        const API_PATH = "/category/tree/get";
        const TIMESTAMP = Date.now();

        const lazadaData = await Lazada.findOne();
        const params = {
            app_key: CLIENT_ID,
            sign_method: "sha256",
            timestamp: TIMESTAMP,
            access_token: lazadaData?.access_token || "",
            language_code: "id_ID"
        };

        const sign = generateSign(API_PATH, params, CLIENT_SECRET);
        params.sign = sign;

        const url = `https://api.lazada.co.id/rest${API_PATH}?${new URLSearchParams(params).toString()}`;
        const response = await axios.get(url);

        return res.json(response.data);
    } catch (err) {
        console.error("❌ Lazada Get Category Tree Error:", err.response?.data || err.message);
        return res.status(500).json({ error: err.response?.data || err.message });
    }
};

/**
 * Get Brands (paged)
 */
const getBrands = async (req, res) => {
    try {
        const CLIENT_ID = process.env.LAZADA_APP_KEY;
        const CLIENT_SECRET = process.env.LAZADA_APP_SECRET;
        const API_PATH = "/category/brands/query";
        const TIMESTAMP = Date.now();

        const { startRow = 0, pageSize = 50 } = req.query;

        const lazadaData = await Lazada.findOne();
        const params = {
            app_key: CLIENT_ID,
            sign_method: "sha256",
            timestamp: TIMESTAMP,
            access_token: lazadaData?.access_token || "",
            startRow,
            pageSize
        };

        const sign = generateSign(API_PATH, params, CLIENT_SECRET);
        params.sign = sign;

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
    getBrands
};
