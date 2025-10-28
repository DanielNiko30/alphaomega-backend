const axios = require('axios');
const fs = require("fs");
const crypto = require('crypto');
const { Lazada } = require('../model/lazada_model');
const { Product } = require('../model/product_model');
const { Stok } = require('../model/stok_model');
const { getDB } = require("../config/sequelize");
const { HTransJual } = require("../model/htrans_jual_model");
const { DTransJual } = require("../model/dtrans_jual_model");
const FormData = require("form-data");
const sharp = require("sharp");
const qs = require("qs");
const { Builder } = require("xml2js");
const moment = require("moment-timezone");

/**
* @param {string} apiPath
 * @param {Object<string, string>} allParams
 * @param {string} appSecret
 * @returns {string}
 * @param {number} weightBody
 * @param {Array} options
 * @returns {string}
 */

const db = getDB();

function generateSign(apiPath, params, appSecret) {
    const sortedKeys = Object.keys(params).sort();
    let baseString = apiPath;
    for (const key of sortedKeys) {
        baseString += key + params[key];
    }
    const sign = crypto
        .createHmac("sha256", appSecret)
        .update(baseString, "utf8")
        .digest("hex")
        .toUpperCase();
    return sign;
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
    try {
        const CLIENT_ID = process.env.LAZADA_APP_KEY.trim();
        const CLIENT_SECRET = process.env.LAZADA_APP_SECRET.trim();
        const API_PATH = "/auth/token/refresh";

        const lazada = await Lazada.findOne();
        if (!lazada) throw new Error("Token Lazada tidak ditemukan di DB");

        const timestamp = String(Date.now());
        const refresh_token = lazada.refresh_token.trim();

        const params = {
            app_key: CLIENT_ID,
            refresh_token,
            sign_method: "sha256",
            timestamp,
        };

        // ✅ Generate sign
        const sign = generateSign(API_PATH, params, CLIENT_SECRET);
        params.sign = sign;

        // ✅ Kirim via body (bukan query)
        const response = await axios.post(
            `https://auth.lazada.com/rest${API_PATH}`,
            new URLSearchParams(params),
            {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            }
        );

        console.log("✅ Refresh token success:", response.data);

        const tokenData = response.data;
        if (!tokenData.access_token)
            throw new Error("Refresh gagal: access_token kosong");

        await lazada.update({
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token || refresh_token,
            expires_in: tokenData.expires_in,
            last_updated: Math.floor(Date.now() / 1000),
        });

        console.log("✅ Token Lazada berhasil diperbarui");
    } catch (err) {
        console.error("❌ Gagal refresh token Lazada:", err.response?.data || err.message);
    }
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
        const {
            created_after,
            created_before,
            status,
            limit = 20,
            offset = 0,
            sort_by = "created_at",
            sort_direction = "DESC",
        } = req.query;

        // Ambil token Lazada dari DB
        const lazadaData = await Lazada.findOne();
        if (!lazadaData?.access_token) {
            return res.status(400).json({ success: false, message: "Token Lazada tidak ditemukan di DB" });
        }

        const accessToken = lazadaData.access_token.trim();
        const apiKey = process.env.LAZADA_APP_KEY.trim();
        const appSecret = process.env.LAZADA_APP_SECRET.trim();

        const apiPath = "/orders/get";
        const baseUrl = "https://api.lazada.co.id/rest"; // ✅ toko asli
        const timestamp = Date.now().toString();

        // 🔸 Minimal wajib created_after (karena tanpa ini hasilnya [] dari API Lazada)
        const params = {
            app_key: apiKey,
            access_token: accessToken,
            sign_method: "sha256",
            timestamp,
            v: "1.0",
            limit,
            offset,
            sort_by,
            sort_direction,
            created_after: created_after || "2022-01-01T00:00:00+08:00", // default aman
        };

        if (created_before) params.created_before = created_before;
        if (status) params.status = status;

        // 🔏 Generate signature
        const sign = generateSign(apiPath, params, appSecret);

        // 🔗 Buat URL final
        const url = `${baseUrl}${apiPath}?${new URLSearchParams({
            ...params,
            sign,
        }).toString()}`;

        // 🔁 Panggil API Lazada
        const response = await axios.get(url);
        const orders = response.data?.data?.orders || [];

        return res.json({
            success: true,
            message: "Berhasil mengambil daftar pesanan dari Lazada (Production)",
            count: orders.length,
            data: orders,
        });
    } catch (err) {
        console.error("❌ Error Get Lazada Orders:", err.response?.data || err.message);
        res.status(500).json({
            success: false,
            message: "Gagal mengambil daftar pesanan dari Lazada",
            error: err.response?.data || err.message,
        });
    }
};

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

const getLazadaOrdersWithItems = async (req, res) => {
    try {
        // === Ambil token Lazada dari DB ===
        const lazadaData = await Lazada.findOne();
        if (!lazadaData?.access_token) {
            return res.status(400).json({
                success: false,
                message: "Token Lazada tidak ditemukan di DB",
            });
        }

        const accessToken = lazadaData.access_token.trim();
        const apiKey = process.env.LAZADA_APP_KEY.trim();
        const appSecret = process.env.LAZADA_APP_SECRET.trim();
        const baseUrl = "https://api.lazada.co.id/rest";

        // === Ambil daftar order READY_TO_SHIP (alias pending dikirim) ===
        const apiPath = "/orders/get";
        const timestamp = Date.now().toString();

        const params = {
            app_key: apiKey,
            access_token: accessToken,
            sign_method: "sha256",
            timestamp,
            v: "1.0",
            limit: 50,
            offset: 0,
            created_after: "2024-01-01T00:00:00+08:00",
            status: "pending", // ✅ ambil yang siap dikirim
        };

        const sign = generateSign(apiPath, params, appSecret);
        const url = `${baseUrl}${apiPath}?${new URLSearchParams({
            ...params,
            sign,
        }).toString()}`;

        const orderListResp = await axios.get(url);
        const orders = orderListResp.data?.data?.orders || [];

        if (orders.length === 0) {
            return res.json({
                success: true,
                message: "Tidak ada pesanan Ready To Ship di Lazada",
                data: [],
            });
        }

        const finalOrders = [];

        // === Loop setiap order untuk ambil detail item ===
        for (const order of orders) {
            const order_id = order.order_id;

            // Step 1: Ambil detail pesanan
            const detailPath = "/order/get";
            const paramsOrder = {
                app_key: apiKey,
                access_token: accessToken,
                sign_method: "sha256",
                timestamp: Date.now().toString(),
                v: "1.0",
                order_id,
            };
            const signOrder = generateSign(detailPath, paramsOrder, appSecret);
            const urlOrder = `${baseUrl}${detailPath}?${new URLSearchParams({
                ...paramsOrder,
                sign: signOrder,
            }).toString()}`;
            const orderDetailResp = await axios.get(urlOrder);
            const orderDetail = orderDetailResp.data?.data || {};

            // Step 2: Ambil item pesanan
            const itemPath = "/order/items/get";
            const paramsItem = {
                app_key: apiKey,
                access_token: accessToken,
                sign_method: "sha256",
                timestamp: Date.now().toString(),
                v: "1.0",
                order_id,
            };
            const signItem = generateSign(itemPath, paramsItem, appSecret);
            const urlItem = `${baseUrl}${itemPath}?${new URLSearchParams({
                ...paramsItem,
                sign: signItem,
            }).toString()}`;
            const itemResp = await axios.get(urlItem);
            const items = itemResp.data?.data || [];

            // === Gabungkan item dengan data lokal ===
            const mergedItems = [];
            for (const item of items) {
                const stok = await db.query(
                    `
                    SELECT 
                        s.id_product_stok,
                        s.id_product_lazada,
                        s.satuan,
                        p.nama_product,
                        p.gambar_product
                    FROM stok s
                    JOIN product p ON p.id_product = s.id_product_stok
                    WHERE s.id_product_lazada = :productId
                    LIMIT 1
                    `,
                    {
                        replacements: { productId: String(item.product_id) },
                        type: db.QueryTypes.SELECT,
                    }
                );

                if (stok.length > 0) {
                    const local = stok[0];
                    const gambarBase64 = local.gambar_product
                        ? `data:image/png;base64,${Buffer.from(local.gambar_product).toString("base64")}`
                        : null;

                    mergedItems.push({
                        item_id: item.order_item_id,
                        product_id: item.product_id,
                        sku_id: item.sku_id,
                        name: item.name,
                        quantity: 1,
                        price: item.item_price,
                        status: item.status,
                        from_db: true,
                        id_product_stok: local.id_product_stok,
                        satuan: local.satuan,
                        nama_product: local.nama_product,
                        image_url: gambarBase64,
                    });
                } else {
                    mergedItems.push({
                        item_id: item.order_item_id,
                        product_id: item.product_id,
                        sku_id: item.sku_id,
                        name: item.name,
                        quantity: 1,
                        price: item.item_price,
                        status: item.status,
                        from_db: false,
                    });
                }
            }

            finalOrders.push({
                order_id: order_id,
                order_number: orderDetail.order_number,
                buyer_name:
                    `${orderDetail.address_shipping?.first_name || ""} ${orderDetail.address_shipping?.last_name || ""}`.trim(),
                total_amount: orderDetail.price,
                payment_method: orderDetail.payment_method,
                status: orderDetail.statuses?.[0],
                created_at: orderDetail.created_at,
                recipient_address: orderDetail.address_shipping,
                items: mergedItems,
            });
        }

        return res.json({
            success: true,
            message: "Berhasil mengambil semua pesanan Ready To Ship + data lokal (Lazada)",
            count: finalOrders.length,
            data: finalOrders,
        });
    } catch (err) {
        console.error("❌ Error getLazadaOrdersWithItems:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil data pesanan Lazada",
            error: err.response?.data || err.message,
        });
    }
};

const getLazadaReadyOrdersWithItems = async (req, res) => {
    try {
        // === Ambil token Lazada dari DB ===
        const lazadaData = await Lazada.findOne();
        if (!lazadaData?.access_token) {
            return res.status(400).json({
                success: false,
                message: "Token Lazada tidak ditemukan di DB",
            });
        }

        const accessToken = lazadaData.access_token.trim();
        const apiKey = process.env.LAZADA_APP_KEY.trim();
        const appSecret = process.env.LAZADA_APP_SECRET.trim();
        const baseUrl = "https://api.lazada.co.id/rest";

        // === Ambil daftar order READY_TO_SHIP (alias pending dikirim) ===
        const apiPath = "/orders/get";
        const timestamp = Date.now().toString();

        const params = {
            app_key: apiKey,
            access_token: accessToken,
            sign_method: "sha256",
            timestamp,
            v: "1.0",
            limit: 50,
            offset: 0,
            created_after: "2024-01-01T00:00:00+08:00",
            status: "ready_to_ship", // ✅ ambil yang siap dikirim
        };

        const sign = generateSign(apiPath, params, appSecret);
        const url = `${baseUrl}${apiPath}?${new URLSearchParams({
            ...params,
            sign,
        }).toString()}`;

        const orderListResp = await axios.get(url);
        const orders = orderListResp.data?.data?.orders || [];

        if (orders.length === 0) {
            return res.json({
                success: true,
                message: "Tidak ada pesanan Ready To Ship di Lazada",
                data: [],
            });
        }

        const finalOrders = [];

        // === Loop setiap order untuk ambil detail item ===
        for (const order of orders) {
            const order_id = order.order_id;

            // Step 1: Ambil detail pesanan
            const detailPath = "/order/get";
            const paramsOrder = {
                app_key: apiKey,
                access_token: accessToken,
                sign_method: "sha256",
                timestamp: Date.now().toString(),
                v: "1.0",
                order_id,
            };
            const signOrder = generateSign(detailPath, paramsOrder, appSecret);
            const urlOrder = `${baseUrl}${detailPath}?${new URLSearchParams({
                ...paramsOrder,
                sign: signOrder,
            }).toString()}`;
            const orderDetailResp = await axios.get(urlOrder);
            const orderDetail = orderDetailResp.data?.data || {};

            // Step 2: Ambil item pesanan
            const itemPath = "/order/items/get";
            const paramsItem = {
                app_key: apiKey,
                access_token: accessToken,
                sign_method: "sha256",
                timestamp: Date.now().toString(),
                v: "1.0",
                order_id,
            };
            const signItem = generateSign(itemPath, paramsItem, appSecret);
            const urlItem = `${baseUrl}${itemPath}?${new URLSearchParams({
                ...paramsItem,
                sign: signItem,
            }).toString()}`;
            const itemResp = await axios.get(urlItem);
            const items = itemResp.data?.data || [];

            // === Gabungkan item dengan data lokal ===
            const mergedItems = [];
            for (const item of items) {
                const stok = await db.query(
                    `
                    SELECT 
                        s.id_product_stok,
                        s.id_product_lazada,
                        s.satuan,
                        p.nama_product,
                        p.gambar_product
                    FROM stok s
                    JOIN product p ON p.id_product = s.id_product_stok
                    WHERE s.id_product_lazada = :productId
                    LIMIT 1
                    `,
                    {
                        replacements: { productId: String(item.product_id) },
                        type: db.QueryTypes.SELECT,
                    }
                );

                if (stok.length > 0) {
                    const local = stok[0];
                    const gambarBase64 = local.gambar_product
                        ? `data:image/png;base64,${Buffer.from(local.gambar_product).toString("base64")}`
                        : null;

                    mergedItems.push({
                        item_id: item.order_item_id,
                        product_id: item.product_id,
                        sku_id: item.sku_id,
                        name: item.name,
                        quantity: 1,
                        price: item.item_price,
                        status: item.status,
                        from_db: true,
                        id_product_stok: local.id_product_stok,
                        satuan: local.satuan,
                        nama_product: local.nama_product,
                        image_url: gambarBase64,
                    });
                } else {
                    mergedItems.push({
                        item_id: item.order_item_id,
                        product_id: item.product_id,
                        sku_id: item.sku_id,
                        name: item.name,
                        quantity: 1,
                        price: item.item_price,
                        status: item.status,
                        from_db: false,
                    });
                }
            }

            finalOrders.push({
                order_id: order_id,
                order_number: orderDetail.order_number,
                buyer_name:
                    `${orderDetail.address_shipping?.first_name || ""} ${orderDetail.address_shipping?.last_name || ""}`.trim(),
                total_amount: orderDetail.price,
                payment_method: orderDetail.payment_method,
                status: orderDetail.statuses?.[0],
                created_at: orderDetail.created_at,
                recipient_address: orderDetail.address_shipping,
                items: mergedItems,
            });
        }

        return res.json({
            success: true,
            message: "Berhasil mengambil semua pesanan Ready To Ship + data lokal (Lazada)",
            count: finalOrders.length,
            data: finalOrders,
        });
    } catch (err) {
        console.error("❌ Error getLazadaOrdersWithItems:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil data pesanan Lazada",
            error: err.response?.data || err.message,
        });
    }
};

const getSeller = async (req, res) => {
    try {
        const lazadaData = await Lazada.findOne();
        if (!lazadaData?.access_token) {
            return res.status(400).json({ success: false, message: "Token Lazada tidak ditemukan" });
        }

        const accessToken = lazadaData.access_token.trim();
        const apiKey = process.env.LAZADA_APP_KEY.trim();
        const appSecret = process.env.LAZADA_APP_SECRET.trim();
        const baseUrl = "https://api.lazada.co.id/rest";
        const apiPath = "/seller/get";

        const params = {
            app_key: apiKey,
            access_token: accessToken,
            sign_method: "sha256",
            timestamp: Date.now().toString(),
            v: "1.0",
        };

        const sign = generateSign(apiPath, params, appSecret);
        const url = `${baseUrl}${apiPath}?${new URLSearchParams({ ...params, sign }).toString()}`;

        const response = await axios.get(url);
        res.json({
            success: true,
            message: "Berhasil ambil info seller",
            data: response.data?.data || {},
        });
    } catch (err) {
        console.error("❌ Error getSeller:", err.response?.data || err.message);
        res.status(500).json({
            success: false,
            message: "Gagal ambil info seller",
            error: err.response?.data || err.message,
        });
    }
};

const getWarehouseBySeller = async (req, res) => {
    try {
        const lazadaData = await Lazada.findOne();
        if (!lazadaData?.access_token) {
            return res.status(400).json({ success: false, message: "Token Lazada tidak ditemukan" });
        }

        const accessToken = lazadaData.access_token.trim();
        const apiKey = process.env.LAZADA_APP_KEY.trim();
        const appSecret = process.env.LAZADA_APP_SECRET.trim();
        const baseUrl = "https://api.lazada.co.id/rest";
        const apiPath = "/rc/warehouse/get";

        const params = {
            app_key: apiKey,
            access_token: accessToken,
            sign_method: "sha256",
            timestamp: Date.now().toString(),
            v: "1.0"
        };

        const sign = generateSign(apiPath, params, appSecret);
        const url = `${baseUrl}${apiPath}?${new URLSearchParams({ ...params, sign }).toString()}`;

        const response = await axios.get(url);
        const warehouses = response.data?.result?.module;
        if (!Array.isArray(warehouses) || warehouses.length === 0) {
            return res.status(500).json({
                success: false,
                message: "Warehouse Lazada kosong",
                raw: response.data
            });
        }

        res.json({
            success: true,
            message: "Berhasil ambil daftar warehouse seller",
            data: warehouses
        });


    } catch (err) {
        console.error("❌ Error getWarehouseBySeller:", err.response?.data || err.message);
        res.status(500).json({
            success: false,
            message: "Gagal ambil daftar warehouse seller",
            error: err.response?.data || err.message
        });
    }
};

const aturPickup = async (req, res) => {
    try {
        const { order_id, driverName } = req.body;

        if (!order_id || !driverName) {
            return res.status(400).json({
                success: false,
                message: "'order_id' dan 'driverName' wajib dikirim"
            });
        }

        // Ambil token Lazada
        const lazadaData = await Lazada.findOne();
        if (!lazadaData?.access_token) {
            return res.status(400).json({ success: false, message: "Token Lazada tidak ditemukan" });
        }

        const accessToken = lazadaData.access_token.trim();
        const apiKey = process.env.LAZADA_APP_KEY.trim();
        const appSecret = process.env.LAZADA_APP_SECRET.trim();
        const baseUrl = "https://api.lazada.co.id/rest";
        const apiPath = "/logistics/tps/runsheets/stops";

        // Ambil sellerId dan warehouseCode
        const sellerResp = await axios.get(`${baseUrl}/seller/get`, {
            params: {
                app_key: apiKey,
                access_token: accessToken,
                sign_method: "sha256",
                timestamp: Date.now().toString(),
                v: "1.0",
                sign: generateSign("/seller/get", {
                    app_key: apiKey,
                    access_token: accessToken,
                    sign_method: "sha256",
                    timestamp: Date.now().toString(),
                    v: "1.0"
                }, appSecret)
            }
        });

        const sellerId = sellerResp.data?.data?.seller_id;
        if (!sellerId) throw new Error("Gagal ambil sellerId");

        const warehouseResp = await axios.get(`${baseUrl}/rc/warehouse/get`, {
            params: {
                app_key: apiKey,
                access_token: accessToken,
                sign_method: "sha256",
                timestamp: Date.now().toString(),
                v: "1.0",
                sign: generateSign("/rc/warehouse/get", {
                    app_key: apiKey,
                    access_token: accessToken,
                    sign_method: "sha256",
                    timestamp: Date.now().toString(),
                    v: "1.0"
                }, appSecret)
            }
        });

        const warehouseList = warehouseResp.data?.result?.module;
        if (!warehouseList || warehouseList.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Warehouse Lazada kosong"
            });
        }

        // Ambil warehouseCode pertama (default)
        const warehouseCode = warehouseList[0].code;

        // Siapkan payload wajib
        const payload = {
            stopId: `STOP-${order_id}`,       // stopId unik
            sellerId: String(sellerId),
            warehouseCode: warehouseCode,
            pickupType: "Drop-off",
            status: "planned",
            statusUpdateTime: Date.now(),
            driverName
        };

        // Generate signature untuk POST
        const timestamp = Date.now().toString();
        const sign = generateSign(apiPath, {
            ...payload,
            app_key: apiKey,
            access_token: accessToken,
            sign_method: "sha256",
            timestamp,
            v: "1.0"
        }, appSecret);

        const postUrl = `${baseUrl}${apiPath}?${new URLSearchParams({
            app_key: apiKey,
            access_token: accessToken,
            sign_method: "sha256",
            timestamp,
            v: "1.0",
            sign
        }).toString()}`;

        const response = await axios.post(postUrl, payload);

        res.json({
            success: true,
            message: "Pickup berhasil diatur",
            data: response.data
        });

    } catch (err) {
        console.error("❌ Error aturPickup:", err.response?.data || err.message);
        res.status(500).json({
            success: false,
            message: "Gagal atur pickup",
            error: err.response?.data || err.message
        });
    }
};

function hmacHex(secret, str) {
    return crypto.createHmac("sha256", secret).update(str, "utf8").digest("hex").toUpperCase();
}

// helper: produce baseString given api and ordered params (params object assumed values are strings)
function buildBaseString(apiName, paramsSortedKeys, paramsObj, bodyStr, options = {}) {
    // options: { appendApiSuffix: bool, prependApiPrefix: bool }
    let s = options.prependApiPrefix ? apiName + '' : apiName;
    for (const k of paramsSortedKeys) {
        const v = paramsObj[k];
        if (v !== undefined && v !== null && String(v) !== '') s += k + String(v);
    }
    if (bodyStr != null) s += bodyStr;
    if (options.appendApiSuffix) s += apiName;
    return s;
}

// try one combo
async function attempt(apiName, baseUrl, sendQueryParams, paramsForSign, bodyStr, appSecret, enc) {
    // enc: 'utf8' (normal) or 'buffer' (Buffer.from(...))
    // compute baseString
    const keys = Object.keys(paramsForSign).sort();
    const baseString = buildBaseString(apiName, keys, paramsForSign, bodyStr);
    // compute sign with utf8 or via Buffer
    let sign;
    if (enc === 'buffer') {
        sign = crypto.createHmac("sha256", appSecret).update(Buffer.from(baseString, 'utf8')).digest("hex").toUpperCase();
    } else {
        sign = hmacHex(appSecret, baseString);
    }

    const queryObj = { ...sendQueryParams, sign };
    const url = `${baseUrl}${apiName}?${new URLSearchParams(queryObj).toString()}`;

    try {
        const resp = await axios.post(url, bodyStr, {
            headers: { "Content-Type": "application/json" },
            timeout: 30000,
        });
        return { ok: true, status: resp.status, data: resp.data, debug: { baseString, sign, url, encoding: enc } };
    } catch (err) {
        return { ok: false, status: err.response?.status || null, error: err.response?.data || err.message, debug: { baseString, sign, url, encoding: enc } };
    }
}

const printLazadaResi = async (req, res) => {
    try {
        const { package_id } = req.body;
        if (!package_id) return res.status(400).json({ success: false, message: "package_id wajib diisi" });

        const tokenRow = await Lazada.findOne();
        if (!tokenRow || !tokenRow.access_token) return res.status(400).json({ success: false, message: "Access token tidak ditemukan" });

        const access_token = String(tokenRow.access_token).trim();
        const app_key = String(process.env.LAZADA_APP_KEY || "").trim();
        const app_secret = String(process.env.LAZADA_APP_SECRET || "").trim();
        if (!app_key || !app_secret) return res.status(500).json({ success: false, message: "LAZADA_APP_KEY/SECRET belum diset" });

        const apiName = "/order/package/document/get";
        const baseUrl = "https://api.lazada.co.id/rest";
        const timestamp = String(Date.now());
        const sign_method = "sha256";
        const v = "1.0";

        // Build a few body variants (order of keys may matter on Lazada)
        const bodies = [
            // official structure, print_item_list false
            { getDocumentReq: { doc_type: "PDF", packages: [{ package_id }], print_item_list: false } },
            // official structure, print_item_list true
            { getDocumentReq: { doc_type: "PDF", packages: [{ package_id }], print_item_list: true } },
            // alternative ordering of keys inside getDocumentReq
            { getDocumentReq: { packages: [{ package_id }], print_item_list: false, doc_type: "PDF" } },
            // body as simple wrapper (just in case)
            { package_id },
        ];

        // prepare query params sent in URL
        const sendQueryParams = { access_token, app_key, sign_method, timestamp, v };

        // candidate param sets to be used in baseString (some APIs include access_token others not)
        const paramSets = [
            { access_token, app_key, sign_method, timestamp, v },
            { app_key, sign_method, timestamp, v },
            { access_token, app_key, sign_method, timestamp },
            { app_key, sign_method, timestamp },
        ];

        // encodings tried
        const encodings = ['utf8', 'buffer'];

        const attempts = [];

        // try all combinations
        for (const bodyObj of bodies) {
            const bodyStrCompact = JSON.stringify(bodyObj); // compact
            const bodyStrPretty = JSON.stringify(bodyObj, null, 0); // same as compact, but keep for symmetry
            const bodyVariants = [bodyStrCompact, bodyStrPretty];

            for (const bodyStr of bodyVariants) {
                for (const paramsForSign of paramSets) {
                    for (const enc of encodings) {
                        const r = await attempt(apiName, baseUrl, sendQueryParams, paramsForSign, bodyStr, app_secret, enc);
                        attempts.push(r);
                        // quick success detection: if resp is ok and not "IncompleteSignature"
                        if (r.ok && r.data && String(r.data.code || '').toLowerCase() !== 'incompletesignature') {
                            return res.json({ success: true, message: "Found working variant", result: r, allAttempts: attempts });
                        }
                    }
                }
            }
        }

        return res.status(500).json({ success: false, message: "No variant accepted by Lazada", allAttempts: attempts });

    } catch (e) {
        console.error("debug-run error", e);
        return res.status(500).json({ success: false, message: e.message, stack: e.stack });
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
    getLazadaOrders,
    getLazadaOrdersWithItems,
    getLazadaReadyOrdersWithItems,
    getSeller,
    getWarehouseBySeller,
    aturPickup,
    printLazadaResi
};