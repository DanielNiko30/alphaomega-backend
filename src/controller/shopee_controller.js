const crypto = require("crypto");
const https = require("https");
const { Product } = require("../model/product_model");
const { Stok } = require("../model/stok_model");
const { Shopee } = require("../model/shopee_model");

const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
let PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;
if (PARTNER_KEY) PARTNER_KEY = PARTNER_KEY.trim();

/* =============================
    Helper: POST Request ke Shopee
============================= */
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

/* =============================
    Helper: GET Request ke Shopee
============================= */
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

/* =============================
    Helper: Generate Signature Shopee
============================= */
function generateSign(path, timestamp, access_token, shop_id) {
    const baseString = `${PARTNER_ID}${path}${timestamp}${access_token}${shop_id}`;
    return crypto.createHmac("sha256", PARTNER_KEY).update(baseString).digest("hex");
}

/* =============================
    1. Callback Auth Shopee
============================= */
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

/* =============================
    2. Get Product List dari Shopee
============================= */
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

        const {
            logistic_id,
            weight,
            category_id,
            dimension,
            condition,
            item_sku,
        } = req.body;

        // Ambil token Shopee
        const shopeeData = await Shopee.findOne();
        if (!shopeeData || !shopeeData.access_token) {
            return res.status(400).json({ error: "Shopee token not found. Please authorize first." });
        }
        const { shop_id, access_token } = shopeeData;

        // Ambil produk lokal
        const product = await Product.findOne({
            where: { id_product },
            include: [{ model: Stok, as: "stok" }],
        });

        if (!product) {
            return res.status(404).json({ error: "Produk tidak ditemukan" });
        }

        if (product.id_product_shopee) {
            return res.status(400).json({ error: "Produk ini sudah terdaftar di Shopee" });
        }

        // Validasi stok
        const stokUtama = product.stok[0];
        if (!stokUtama) {
            return res.status(400).json({ error: "Produk tidak memiliki stok!" });
        }

        // Generate timestamp & sign
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/product/add_item";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}`;

        // Body untuk Shopee
        const body = {
            original_price: stokUtama.harga,
            description: product.deskripsi_product || "Deskripsi tidak tersedia",
            item_name: product.nama_product,
            item_sku: item_sku || null,
            logistic_info: [
                {
                    logistic_id: logistic_id,
                    enabled: true,
                    is_free: false,
                },
            ],
            weight,
            category_id,
            dimension, // { width, height, length }
            condition, // "NEW" atau "USED"
            normal_stock: stokUtama.stok,
            images: [
                {
                    url: `data:image/png;base64,${product.gambar_product.toString("base64")}`,
                },
            ],
        };

        console.log("Shopee Add Product Body:", JSON.stringify(body, null, 2));

        // Request ke Shopee
        const shopeeResponse = await postJSON(url, body);

        if (shopeeResponse.error) {
            return res.status(400).json({
                success: false,
                message: shopeeResponse.message || "Gagal membuat produk di Shopee",
                shopee_response: shopeeResponse,
            });
        }

        const newShopeeId = shopeeResponse.response?.item_id;

        // Update id_product_shopee di database
        if (newShopeeId) {
            await product.update({ id_product_shopee: newShopeeId });
        }

        return res.status(201).json({
            success: true,
            message: "Produk berhasil ditambahkan ke Shopee",
            shopee_response: shopeeResponse,
            updated_product: {
                id_product: product.id_product,
                nama_product: product.nama_product,
                id_product_shopee: newShopeeId,
            },
        });
    } catch (err) {
        console.error("Shopee Create Product Error:", err);
        return res.status(500).json({ error: err.message });
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
            return res.status(400).json({ error: "Shopee token not found. Please authorize first." });
        }

        const { shop_id, access_token } = shopeeData;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/logistics/get_channel_list";

        const sign = generateSign(path, timestamp, access_token, shop_id);

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}`;

        console.log("Shopee Get Logistic URL:", url);

        const response = await getJSON(url);

        if (response.error) {
            return res.status(400).json({
                success: false,
                message: response.message || "Gagal mengambil logistic Shopee",
                shopee_response: response
            });
        }

        return res.json({
            success: true,
            data: response.response?.logistics || [],
        });
    } catch (err) {
        console.error("Shopee Get Logistic Error:", err);
        return res.status(500).json({ error: err.message });
    }
};

module.exports = { shopeeCallback, getShopeeItemList, createProductShopee, getShopeeCategories, getShopeeLogistics };
