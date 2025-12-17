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
const path = require("path");
const { Op } = require("sequelize");

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
            url,
            params,
            lazada_response: response.data
        });
    } catch (err) {
        console.error("❌ Lazada Get Products Error:", err.response?.data || err.message);
        return res.status(500).json({
            error: err.response?.data || err.message,
            url: err.config?.url || null,
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
            name: `${product.nama_product} ${stokTerpilih.satuan}`,
            brand: attributes.brand || "No Brand",
            description: product.deskripsi_product || "Deskripsi belum tersedia",
            short_description: product.deskripsi_product?.slice(0, 100) || "Short description",
            Net_Weight: attributes.Net_Weight || "500 g", // wajib string
        };

        const skuAttributes = {
            SellerSku: attributes.SellerSku || `SKU-${uniqueSuffix}`,
            quantity: String(stokTerpilih.stok),
            price: String(Math.round(Number(stokTerpilih.harga) * 1.125)),
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
            name: `${product.nama_product} ${stokTerpilih.satuan}`,
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
            price: String(Math.round(Number(stokTerpilih.harga) * 1.125)),
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

const readyToShipLazada = async (req, res) => {
    try {
        const orderId = req.body.order_id || req.query.order_id;
        if (!orderId) return res.status(400).json({ success: false, message: "Parameter 'order_id' wajib diisi" });

        // Ambil user login
        const currentUser = req.user;
        if (!currentUser || !['pegawai online', 'admin'].includes(currentUser.role)) {
            return res.status(403).json({ success: false, message: 'Hanya pegawai online atau admin yang dapat menandai Ready To Ship' });
        }

        // Tentukan id_user untuk transaksi
        let idUserForTransaction;
        if (currentUser.role === 'pegawai online') {
            idUserForTransaction = currentUser.id_user;
        } else {
            const pegawaiOnline = await User.findOne({ where: { role: 'pegawai online' } });
            if (!pegawaiOnline) return res.status(500).json({ success: false, message: 'Pegawai online tidak ditemukan di DB' });
            idUserForTransaction = pegawaiOnline.id_user;
        }

        // Ambil access token Lazada (update: pastikan record ada)
        const lazadaAccount = await Lazada.findOne({ order: [['last_updated', 'DESC']] }); // ambil record terbaru
        if (!lazadaAccount) return res.status(400).json({ success: false, message: "Akun Lazada tidak ditemukan di DB" });
        if (!lazadaAccount.access_token || lazadaAccount.access_token.trim() === "") {
            return res.status(400).json({ success: false, message: "Token Lazada kosong atau tidak valid" });
        }

        const access_token = lazadaAccount.access_token.trim();
        const appKey = process.env.LAZADA_APP_KEY.trim();
        const appSecret = process.env.LAZADA_APP_SECRET.trim();
        const baseUrl = "https://api.lazada.co.id/rest";

        // 1️⃣ Ambil detail order
        const detailRes = await axios.get(`https://tokalphaomegaploso.my.id/api/lazada/order/detail?order_id=${orderId}`);
        const detailData = detailRes.data?.data;

        if (!detailData || !Array.isArray(detailData.items) || detailData.items.length === 0) {
            return res.status(400).json({ success: false, message: "Gagal ambil data order dari Lazada — items kosong" });
        }

        const packageId = detailData.items[0].package_id;
        if (!packageId) return res.status(400).json({ success: false, message: "Tidak menemukan package_id di data order Lazada" });

        // 2️⃣ Cek stok & validasi item
        const stokTidakCukup = [];
        const itemsForTransaction = [];

        for (const item of detailData.items) {
            let stok = await Stok.findOne({ where: { sku_lazada: item.sku_id } });
            if (!stok) stok = await Stok.findOne({ where: { id_product_stok: item.product_id } });

            const qty = parseInt(item.quantity || 1);

            if (!stok || stok.stok < qty) {
                stokTidakCukup.push({
                    id_produk: stok ? stok.id_product_stok : item.product_id,
                    sku_lazada: item.sku_id,
                    nama_produk: item.name,
                    stok_tersedia: stok ? stok.stok : 0,
                    jumlah_diminta: qty,
                    pesan: stok ? "Stok tidak mencukupi" : "Produk tidak ditemukan di stok lokal",
                });
                continue;
            }

            itemsForTransaction.push({
                id_produk: stok.id_product_stok,
                satuan: stok.satuan,
                jumlah_barang: qty,
                harga_satuan: parseFloat(item.item_price) || 0,
                subtotal: qty * (parseFloat(item.item_price) || 0)
            });
        }

        if (stokTidakCukup.length > 0) {
            return res.status(400).json({ success: false, message: "❌ Stok tidak cukup atau produk tidak ditemukan", stok_tidak_cukup: stokTidakCukup });
        }

        // 3️⃣ Buat HTransJual
        const id_htrans_jual = await generateHTransJualId();
        const nomor_invoice = await generateInvoiceNumber();
        const totalHarga = itemsForTransaction.reduce((sum, i) => sum + i.subtotal, 0);

        await HTransJual.create({
            id_htrans_jual,
            id_user: idUserForTransaction,
            id_user_penjual: idUserForTransaction,
            nama_pembeli: detailData.address_shipping?.first_name || "Pembeli Lazada",
            tanggal: new Date(),
            total_harga: Math.floor(totalHarga),
            metode_pembayaran: detailData.order?.payment_method || "Lazada Payment",
            nomor_invoice,
            order_sn: detailData.order?.order_number || orderId,
            package_number: packageId,
            status: "Pending",
            sumber_transaksi: "lazada",
        });

        // 4️⃣ Simpan detail DTransJual & update stok
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

            const stok = await Stok.findOne({ where: { id_product_stok: item.id_produk } });
            if (stok) await stok.update({ stok: stok.stok - item.jumlah_barang });
        }

        // 5️⃣ Ready To Ship API Lazada
        const apiPath = "/order/package/rts";
        const timestamp = Date.now();
        const params = { access_token, app_key: appKey, sign_method: "sha256", timestamp };
        const readyToShipReq = JSON.stringify({ packages: [{ package_id: packageId }] });

        const signParams = { ...params, readyToShipReq };
        const sortedKeys = Object.keys(signParams).sort();
        let baseStr = apiPath;
        for (const key of sortedKeys) baseStr += key + signParams[key];
        const sign = crypto.createHmac("sha256", appSecret).update(baseStr, "utf8").digest("hex").toUpperCase();

        const queryParams = new URLSearchParams({ ...params, sign }).toString();
        const finalUrl = `${baseUrl}${apiPath}?${queryParams}`;
        const bodyData = `readyToShipReq=${readyToShipReq}`;

        const lazadaRes = await axios.post(finalUrl, bodyData, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        const data = lazadaRes.data;

        const successFlag =
            data?.result?.success === true &&
            Array.isArray(data?.result?.data?.packages) &&
            data.result.data.packages.every((p) => p.item_err_code === "0");

        if (successFlag) {
            return res.json({
                success: true,
                message: "✅ Order berhasil ditandai sebagai Ready To Ship di Lazada",
                package_id: packageId,
                invoice: nomor_invoice,
                id_htrans_jual,
                data: data.result.data.packages,
            });
        }

        return res.status(400).json({
            success: false,
            message: "❌ Gagal menandai order sebagai Ready To Ship",
            package_id: packageId,
            error: data,
        });

    } catch (error) {
        const errData = error.response?.data || error.message;
        return res.status(500).json({
            success: false,
            message: "Gagal request Ready To Ship ke Lazada",
            error: errData,
        });
    }
};

const printLazadaResi = async (req, res) => {
    try {
        const orderId = req.body.order_id || req.query.order_id;
        if (!orderId) {
            return res.status(400).json({
                success: false,
                message: "Parameter 'order_id' wajib diisi",
            });
        }

        const lazadaAccount = await Lazada.findOne();
        if (!lazadaAccount?.access_token) {
            return res.status(400).json({
                success: false,
                message: "Token Lazada tidak ditemukan di DB",
            });
        }

        const access_token = lazadaAccount.access_token.trim();
        const appKey = process.env.LAZADA_APP_KEY.trim();
        const appSecret = process.env.LAZADA_APP_SECRET.trim();
        const apiBaseUrl = "https://api.lazada.co.id/rest";

        // ====================================================
        // 1️⃣ Ambil package_id dari order_id
        // ====================================================
        const detailUrl = `https://tokalphaomegaploso.my.id/api/lazada/order/detail?order_id=${orderId}`;
        const detailRes = await axios.get(detailUrl);
        const detailData = detailRes.data?.data;

        if (!detailData || !Array.isArray(detailData.items) || detailData.items.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Gagal ambil data order dari Lazada — items kosong",
            });
        }

        const packageId = detailData.items[0].package_id;
        if (!packageId) {
            return res.status(400).json({
                success: false,
                message: "Tidak menemukan package_id di data order Lazada",
            });
        }

        // ====================================================
        // 2️⃣ Generate signature dan request getDocumentReq
        // ====================================================
        const apiPath = "/order/package/document/get";
        const timestamp = Date.now();

        const params = {
            access_token,
            app_key: appKey,
            sign_method: "sha256",
            timestamp,
        };

        const getDocumentReq = JSON.stringify({
            doc_type: "PDF",
            print_item_list: false,
            packages: [{ package_id: packageId }],
        });

        const signParams = { ...params, getDocumentReq };
        const sortedKeys = Object.keys(signParams).sort();
        let baseStr = apiPath;
        for (const key of sortedKeys) baseStr += key + signParams[key];

        const sign = crypto
            .createHmac("sha256", appSecret)
            .update(baseStr, "utf8")
            .digest("hex")
            .toUpperCase();

        const queryParams = new URLSearchParams({ ...params, sign }).toString();
        const finalUrl = `${apiBaseUrl}${apiPath}?${queryParams}`;
        const bodyData = `getDocumentReq=${getDocumentReq}`;

        const lazadaRes = await axios.post(finalUrl, bodyData, {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            responseType: "arraybuffer",
        });

        const contentType = lazadaRes.headers["content-type"] || "";

        // 🔹 Jika JSON dulu (dapat pdf_url)
        if (contentType.includes("application/json")) {
            const raw = Buffer.from(lazadaRes.data).toString("utf8");
            const parsed = JSON.parse(raw);

            if (parsed.result?.data?.pdf_url) {
                const pdfUrl = parsed.result.data.pdf_url;
                const pdfRes = await axios.get(pdfUrl, { responseType: "arraybuffer" });
                const pdfBase64 = Buffer.from(pdfRes.data).toString("base64");

                return res.status(200).json({
                    success: true,
                    message: `Resi Lazada untuk order_id ${orderId}`,
                    order_id: orderId,
                    package_id: packageId,
                    pdf_base64: pdfBase64,
                });
            }

            return res.status(400).json({
                success: false,
                message: "Lazada mengembalikan JSON tanpa PDF URL",
                raw: parsed,
            });
        }

        // 🔹 Jika langsung PDF
        if (contentType.includes("application/pdf")) {
            const pdfBase64 = Buffer.from(lazadaRes.data).toString("base64");
            return res.status(200).json({
                success: true,
                message: `Resi Lazada untuk order_id ${orderId}`,
                order_id: orderId,
                package_id: packageId,
                pdf_base64: pdfBase64,
            });
        }

        return res.status(400).json({
            success: false,
            message: "Respons dari Lazada tidak diketahui formatnya",
        });
    } catch (error) {
        console.error("❌ Error printLazadaResi:", error.response?.data || error.message);

        const errData = error.response?.data
            ? Buffer.from(error.response.data).toString("utf8")
            : error.message;

        return res.status(500).json({
            success: false,
            message: "Gagal ambil resi dari Lazada",
            error: errData,
        });
    }
};

const updatePriceQuantity = async (req, res) => {
    try {
        // Body dapat single object { item_id, sku_id, quantity }
        // atau multiple SKUs: { item_id, skus: [{ sku_id, quantity }, ...] }
        const { item_id, sku_id, quantity, skus } = req.body;

        if (!item_id) {
            return res.status(400).json({ success: false, message: "item_id wajib diisi" });
        }

        // Normalize skus into array of { ItemId, SkuId, Quantity }
        let skuArray = [];

        if (Array.isArray(skus) && skus.length > 0) {
            // multiple skus supplied
            for (const s of skus) {
                if (!s.sku_id || s.quantity === undefined) {
                    return res.status(400).json({ success: false, message: "Untuk setiap sku harus ada sku_id dan quantity" });
                }
                skuArray.push({
                    ItemId: String(item_id),
                    SkuId: String(s.sku_id),
                    Quantity: String(s.quantity),
                });
            }
        } else {
            // single sku flow
            if (!sku_id || quantity === undefined) {
                return res.status(400).json({ success: false, message: "sku_id dan quantity wajib diisi (atau gunakan skus array)" });
            }
            skuArray.push({
                ItemId: String(item_id),
                SkuId: String(sku_id),
                Quantity: String(quantity),
            });
        }

        // Ambil akun Lazada dari DB
        const account = await Lazada.findOne();
        if (!account) {
            return res.status(400).json({ success: false, message: "Account Lazada tidak ditemukan di DB. Silakan authorize dulu." });
        }

        const accessToken = account.access_token.trim();
        const apiKey = process.env.LAZADA_APP_KEY.trim();
        const appSecret = process.env.LAZADA_APP_SECRET.trim();

        const apiPath = '/product/price_quantity/update';
        const endpointBase = process.env.LAZADA_ENDPOINT || 'https://api.lazada.co.id/rest'; // gunakan env jika beda region
        const timestamp = Date.now().toString();

        // Build XML payload sesuai contoh Lazada
        // Structure: <Request><Product><Skus><Sku>...</Sku></Skus></Product></Request>
        const builder = new Builder({ headless: true, renderOpts: { pretty: false } });
        const xmlObj = {
            Request: {
                Product: {
                    Skus: {
                        Sku: skuArray.map(s => ({
                            ItemId: s.ItemId,
                            SkuId: s.SkuId,
                            Quantity: s.Quantity
                        }))
                    }
                }
            }
        };

        const xmlPayload = builder.buildObject(xmlObj);

        // System params
        const sysParams = {
            app_key: apiKey,
            access_token: accessToken,
            sign_method: 'sha256',
            timestamp,
            v: '1.0'
        };

        // Generate sign including payload (Lazada requires payload included in signing)
        const sign = generateSign(apiPath, { ...sysParams, payload: xmlPayload }, appSecret);

        // Build final URL
        const url = `${endpointBase}${apiPath}?${new URLSearchParams({ ...sysParams, sign }).toString()}`;

        // Send request as application/x-www-form-urlencoded with payload=<xml>
        const bodyForRequest = new URLSearchParams({ payload: xmlPayload });

        const lazadaRes = await axios.post(url, bodyForRequest.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000
        });

        // Return response langsung ke frontend (sertakan debug jika perlu)
        return res.status(200).json({
            success: true,
            message: 'Request update stock dikirim ke Lazada',
            request: {
                url,
                payload: xmlPayload
            },
            lazada_response: lazadaRes.data
        });

    } catch (err) {
        console.error('❌ Lazada updatePriceQuantity Error:', err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: 'Gagal update stock ke Lazada',
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
    printLazadaResi,
    readyToShipLazada,
    updatePriceQuantity
};