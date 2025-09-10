const crypto = require("crypto");
const https = require("https");
const FormData = require("form-data");
const axios = require("axios");
const { Product } = require("../model/product_model");
const { Stok } = require("../model/stok_model");
const { Shopee } = require("../model/shopee_model");

const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
let PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;
if (PARTNER_KEY) PARTNER_KEY = PARTNER_KEY.trim();

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
        const { logistic_id, weight, category_id, dimension, condition, item_sku } = req.body;

        console.log("🚀 Starting createProductShopee for", id_product);

        // 1️⃣ Ambil token Shopee
        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token) {
            console.log("❌ Shopee token tidak ditemukan");
            return res.status(400).json({ error: "Shopee token not found. Please authorize first." });
        }
        const { shop_id, access_token } = shopeeData;
        console.log("🔹 Shopee access_token found, shop_id:", shop_id);

        // 2️⃣ Ambil data produk + stok
        const product = await Product.findOne({
            where: { id_product },
            include: [{ model: Stok, as: "stok" }],
        });

        if (!product) {
            console.log("❌ Produk tidak ditemukan di DB");
            return res.status(404).json({ error: "Produk tidak ditemukan" });
        }

        if (!product.gambar_product) {
            console.log("❌ Produk tidak memiliki gambar");
            return res.status(400).json({ error: "Produk tidak memiliki gambar!" });
        }

        if (product.id_product_shopee) {
            console.log("❌ Produk sudah terdaftar di Shopee");
            return res.status(400).json({ error: "Produk sudah terdaftar di Shopee" });
        }

        const stokUtama = product.stok[0];
        if (!stokUtama) {
            console.log("❌ Produk tidak memiliki stok");
            return res.status(400).json({ error: "Produk tidak memiliki stok!" });
        }

        console.log("🔹 Produk & stok valid, mulai upload gambar...");

        // 3️⃣ Upload gambar ke Shopee
        const timestamp = Math.floor(Date.now() / 1000);
        const uploadPath = "/api/v2/media_space/upload_image";
        const uploadSign = generateSign(uploadPath, timestamp, access_token, shop_id);
        const uploadUrl = `https://partner.shopeemobile.com${uploadPath}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${uploadSign}`;

        console.log("🔹 Upload URL:", uploadUrl);

        const imageBuffer = Buffer.isBuffer(product.gambar_product)
            ? product.gambar_product
            : Buffer.from(product.gambar_product);

        console.log("🔹 Image buffer length:", imageBuffer.length);
        if (!imageBuffer || imageBuffer.length === 0) {
            console.log("❌ Gambar kosong atau invalid");
            return res.status(400).json({ error: "Gambar kosong atau invalid!" });
        }

        const formData = new FormData();
        formData.append("image", imageBuffer, {
            filename: `${product.id_product}.png`,
            contentType: "image/png",
        });

        console.log("🔹 Mengirim gambar ke Shopee...");
        const uploadResponse = await axios.post(uploadUrl, formData, {
            headers: formData.getHeaders(),
        });

        console.log("🔹 Shopee upload response:", JSON.stringify(uploadResponse.data, null, 2));

        const uploadedImageId = uploadResponse.data?.response?.image_info?.image_id;
        if (!uploadedImageId) {
            console.log("❌ Upload gagal, image_id tidak ada", uploadResponse.data);
            return res.status(400).json({
                success: false,
                message: "Gagal mendapatkan image_id dari Shopee",
                shopee_response: uploadResponse.data,
            });
        }

        console.log("✅ Image uploaded successfully. Image ID:", uploadedImageId);

        // 4️⃣ Body Add Item (update sesuai requirement terbaru)
        const body = {
            original_price: Number(stokUtama.harga),
            description: product.deskripsi_product || "Deskripsi tidak tersedia",
            item_name: product.nama_product,
            item_sku: item_sku || null,
            weight: Number(weight),
            package_height: Number(dimension.height),
            package_length: Number(dimension.length),
            package_width: Number(dimension.width),
            logistic_info: [
                {
                    logistic_id: Number(logistic_id),
                    enabled: true,
                    is_free: false,
                },
            ],
            category_id: Number(category_id),
            stock: Number(stokUtama.stok),
            condition: condition || "NEW",
            image: {
                image_id_list: [uploadedImageId],
                image_ratio: "1:1"
            }
        };

        console.log("🔹 Shopee Add Item body:", JSON.stringify(body, null, 2));

        const addItemPath = "/api/v2/product/add_item";
        const addItemSign = generateSign(addItemPath, timestamp, access_token, shop_id);
        const addItemUrl = `https://partner.shopeemobile.com${addItemPath}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${addItemSign}`;

        console.log("🔹 Add Item URL:", addItemUrl);

        const createResponse = await axios.post(addItemUrl, body, { headers: { "Content-Type": "application/json" } });

        console.log("🔹 Shopee Add Item response:", JSON.stringify(createResponse.data, null, 2));

        if (createResponse.data.error) {
            console.log("❌ Shopee Add Item Error:", createResponse.data);
            return res.status(400).json({
                success: false,
                message: createResponse.data.message,
                shopee_response: createResponse.data,
            });
        }

        const newShopeeId = createResponse.data.response?.item_id;
        if (newShopeeId) await product.update({ id_product_shopee: newShopeeId });

        console.log("✅ Produk berhasil ditambahkan ke Shopee. Item ID:", newShopeeId);

        return res.status(201).json({
            success: true,
            message: "Produk berhasil ditambahkan ke Shopee",
            shopee_response: createResponse.data,
            updated_product: {
                id_product: product.id_product,
                nama_product: product.nama_product,
                id_product_shopee: newShopeeId,
            },
        });

    } catch (err) {
        console.error("❌ Shopee Create Product Error:", err.response?.data || err.message);
        return res.status(500).json({ error: err.response?.data || err.message });
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
