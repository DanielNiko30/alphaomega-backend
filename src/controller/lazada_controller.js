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

// --- Fungsi Upload Gambar ke Lazada ---
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

// ✅ Controller create product
const createProductLazada = async (req, res) => {
    try {
        const { id_product } = req.params;
        const { category_id, selected_unit, attributes = {} } = req.body;

        if (!category_id) {
            return res.status(400).json({
                success: false,
                message: "category_id wajib dikirim di body",
            });
        }

        // 1️⃣ Ambil akun Lazada
        const account = await Lazada.findOne();
        if (!account) throw new Error("Tidak ada account Lazada di DB");

        const accessToken = account.access_token.trim();
        const apiKey = process.env.LAZADA_APP_KEY.trim();
        const appSecret = process.env.LAZADA_APP_SECRET.trim();
        const apiPath = "/product/create";
        const timestamp = Date.now().toString();
        const uniqueSuffix = Date.now().toString().slice(-6);

        // 2️⃣ Ambil data produk
        const product = await Product.findOne({
            where: { id_product },
            include: [{ model: Stok, as: "stok" }],
        });
        if (!product) throw new Error("Produk tidak ditemukan di database");

        const stokTerpilih = selected_unit
            ? product.stok.find((s) => s.satuan === selected_unit)
            : product.stok[0];
        if (!stokTerpilih)
            throw new Error("Stok untuk satuan tersebut tidak ditemukan");

        // 3️⃣ Upload gambar ke Lazada
        const uploadedImageUrl = await uploadImageToLazadaFromDB(product, accessToken);

        // 4️⃣ Ambil atribut kategori
        let requiredAttributes = [];
        try {
            const attrResp = await axios.get(
                `https://tokalphaomegaploso.my.id/api/lazada/category/attribute/${category_id}`
            );

            if (attrResp.data?.success && Array.isArray(attrResp.data.required_attributes)) {
                requiredAttributes = attrResp.data.required_attributes;
            } else {
                return res.status(400).json({
                    success: false,
                    message: "Format response atribut tidak sesuai",
                    response_data: attrResp.data,
                });
            }
        } catch (err) {
            return res.status(500).json({
                success: false,
                message: "Gagal ambil category attributes",
                error: err.response?.data || err.message,
            });
        }

        // 5️⃣ Product Attributes dasar
        const productAttributes = {
            name: product.nama_product,
            description: product.deskripsi_product || "Deskripsi belum tersedia",
            brand: attributes.brand || "No Brand",
        };

        // 6️⃣ SKU dasar
        const skuAttributes = {
            SellerSku: attributes.SellerSku || `SKU-${uniqueSuffix}`,
            quantity: stokTerpilih.stok,
            price: String(stokTerpilih.harga_jual || 1000),
            package_height: String(attributes.package_height || stokTerpilih.tinggi || 10),
            package_length: String(attributes.package_length || stokTerpilih.panjang || 10),
            package_width: String(attributes.package_width || stokTerpilih.lebar || 10),
            package_weight: String(attributes.package_weight || stokTerpilih.berat || 0.5),
            package_content: `${product.nama_product} - ${attributes.brand || "No Brand"}`,
        };

        // 7️⃣ Mapping atribut wajib
        for (const attr of requiredAttributes) {
            const attrId = attr.id;
            const keyName = attr.name?.toLowerCase();

            if (keyName === "brand") continue;

            let value = attributes[attr.name] || attributes[attr.label] || "";

            // Kalau value berupa object { attribute_id, value_id }
            if (typeof value === "object" && value.value_id) {
                productAttributes[attrId] = { value_id: value.value_id };
                continue;
            }

            // Jika atribut numeric
            if (!value && attr.input_type === "numeric") value = "1";

            // Jika atribut berat bersih
            if (keyName.includes("net_weight") || keyName.includes("berat")) {
                // Jika user kirim langsung ID, bungkus jadi object { value_id }
                const netWeightValue =
                    typeof attributes.Net_Weight === "object"
                        ? attributes.Net_Weight.value_id
                        : attributes.Net_Weight;

                productAttributes[attrId] = { value_id: Number(netWeightValue) };
            } else {
                productAttributes[attrId] = value;
            }

        }

        // 8️⃣ Payload final ke Lazada
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

        // 9️⃣ Generate Signature
        const sysParams = {
            app_key: apiKey,
            access_token: accessToken,
            sign_method: "sha256",
            timestamp,
            v: "1.0",
        };

        const jsonBody = JSON.stringify(productObj);
        const sign = generateSign(apiPath, { ...sysParams, payload: jsonBody }, appSecret);
        const url = `https://api.lazada.co.id/rest${apiPath}?${new URLSearchParams({
            ...sysParams,
            sign,
        }).toString()}`;

        const bodyForRequest = new URLSearchParams({ payload: jsonBody });

        // 🔟 Request ke Lazada
        const response = await axios.post(url, bodyForRequest, {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });

        res.json({
            success: true,
            message: "Produk berhasil ditambahkan ke Lazada.",
            image_used: uploadedImageUrl,
            lazada_response: response.data,
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
    getCategoryAttributes,
    getAllCategoryAttributes
};