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
        const { weight, category_id, dimension, condition, item_sku, brand_id, brand_name, selected_unit } = req.body;

        // 1️⃣ Ambil token Shopee
        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token) return res.status(400).json({ error: "Shopee token not found." });
        const { shop_id, access_token } = shopeeData;

        // 2️⃣ Ambil data produk + stok
        const product = await Product.findOne({
            where: { id_product },
            include: [{ model: Stok, as: "stok" }],
        });
        if (!product) return res.status(404).json({ error: "Produk tidak ditemukan" });
        if (!product.gambar_product) return res.status(400).json({ error: "Produk tidak memiliki gambar!" });
        if (product.id_product_shopee) return res.status(400).json({ error: "Produk sudah terdaftar di Shopee" });

        // 3️⃣ Pilih stok sesuai satuan
        const stokTerpilih = selected_unit
            ? product.stok.find(s => s.satuan === selected_unit)
            : product.stok[0];
        if (!stokTerpilih) return res.status(400).json({ error: `Stok untuk satuan ${selected_unit} tidak ditemukan` });

        // 4️⃣ Ambil channel logistik Shopee yang valid
        const timestamp = Math.floor(Date.now() / 1000);
        const logisticPath = "/api/v2/logistics/get_channel_list";
        const logisticSign = generateSign(logisticPath, timestamp, access_token, shop_id);
        const logisticUrl = `https://partner.shopeemobile.com${logisticPath}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${logisticSign}`;

        const logisticResponse = await getJSON(logisticUrl);
        const validChannels = (logisticResponse.response?.logistics_channel_list || []).filter(
            ch => ch.enabled === true && ch.seller_logistic_has_configuration === true
        );
        if (!validChannels.length) {
            return res.status(400).json({ error: "Tidak ada channel logistik Shopee yang valid. Harap konfigurasi shipping di Seller Center." });
        }

        const selectedChannel = validChannels[0];

        // 5️⃣ Upload gambar
        const uploadPath = "/api/v2/media_space/upload_image";
        const uploadSign = generateSign(uploadPath, timestamp, access_token, shop_id);
        const uploadUrl = `https://partner.shopeemobile.com${uploadPath}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${uploadSign}`;
        const imageBuffer = Buffer.isBuffer(product.gambar_product) ? product.gambar_product : Buffer.from(product.gambar_product);

        const formData = new FormData();
        formData.append("image", imageBuffer, { filename: `${product.id_product}.png`, contentType: "image/png" });
        const uploadResponse = await axios.post(uploadUrl, formData, { headers: formData.getHeaders() });
        const uploadedImageId = uploadResponse.data?.response?.image_info?.image_id;
        if (!uploadedImageId) return res.status(400).json({ error: "Gagal mendapatkan image_id dari Shopee", shopee_response: uploadResponse.data });

        // 6️⃣ Body Add Item
        const body = {
            original_price: Number(stokTerpilih.harga),
            description: product.deskripsi_product || "Deskripsi tidak tersedia",
            item_name: product.nama_product,
            item_sku: item_sku || null,
            weight: Number(weight),
            package_height: Number(dimension.height),
            package_length: Number(dimension.length),
            package_width: Number(dimension.width),
            logistic_info: [
                {
                    logistics_channel_id: Number(selectedChannel.id), // ✅ harus pakai ini
                    enabled: true,
                    is_free: false
                }
            ],
            category_id: Number(category_id),
            seller_stock: [
                {
                    stock_location_id: 0,
                    stock: Number(stokTerpilih.stok)
                }
            ],
            condition: condition || "NEW",
            image: { image_id_list: [uploadedImageId], image_ratio: "1:1" },
            brand: { brand_id: Number(brand_id) || 0, original_brand_name: brand_name || "No Brand" }
        };

        const addItemPath = "/api/v2/product/add_item";
        const addItemSign = generateSign(addItemPath, timestamp, access_token, shop_id);
        const addItemUrl = `https://partner.shopeemobile.com${addItemPath}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${addItemSign}`;

        const createResponse = await axios.post(addItemUrl, body, { headers: { "Content-Type": "application/json" } });

        if (createResponse.data.error) {
            return res.status(400).json({ success: false, message: createResponse.data.message, shopee_response: createResponse.data });
        }

        const newShopeeId = createResponse.data.response?.item_id;
        if (newShopeeId) await product.update({ id_product_shopee: newShopeeId });

        return res.status(201).json({
            success: true,
            message: "Produk berhasil ditambahkan ke Shopee",
            shopee_response: createResponse.data,
            updated_product: { id_product: product.id_product, nama_product: product.nama_product, id_product_shopee: newShopeeId },
        });

    } catch (err) {
        console.error("❌ Shopee Create Product Error:", err.response?.data || err.message);
        return res.status(500).json({ error: err.response?.data || err.message, message: "Gagal menambahkan produk ke Shopee." });
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
            console.log("❌ Shopee token tidak ditemukan");
            return res.status(400).json({ error: "Shopee token not found. Please authorize first." });
        }

        const { shop_id, access_token } = shopeeData;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/logistics/get_channel_list";
        const sign = generateSign(path, timestamp, access_token, shop_id);
        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}`;

        console.log("🔹 Shopee Get Logistic URL:", url);

        const response = await getJSON(url);

        if (response.error) {
            console.error("❌ Shopee API Error:", response);
            return res.status(400).json({
                success: false,
                message: response.message || "Gagal mengambil logistic Shopee",
                shopee_response: response
            });
        }

        const allChannels = response.response?.logistics_channel_list || [];

        // Debug: tampilkan detail semua channel supaya bisa ambil ID
        const channelDetails = allChannels.map((ch) => ({
            id: ch.logistics_channel_id,
            name: ch.logistics_channel_name,
            enabled: ch.enabled,
            cod_enabled: ch.cod_enabled,
            fee_type: ch.fee_type,
            seller_logistic_has_configuration: ch.seller_logistic_has_configuration,
            force_enable: ch.force_enable,
            mask_channel_id: ch.mask_channel_id,
        }));

        console.log("🔹 Semua channel detail:", JSON.stringify(channelDetails, null, 2));

        return res.json({
            success: true,
            total_channels: allChannels.length,
            channels: channelDetails,
        });

    } catch (err) {
        console.error("❌ Shopee Get Logistic Error:", err);
        return res.status(500).json({ error: err.message });
    }
};

const getBrandListShopee = async (req, res) => {
    try {
        const { category_id, status = 1, offset = 0, page_size = 10, language = "en" } = req.body;

        if (!category_id) return res.status(400).json({ error: "category_id is required" });

        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token) return res.status(400).json({ error: "Shopee token not found. Please authorize first." });

        const { shop_id, access_token } = shopeeData;

        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/product/brand/get_brand_list";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}`;

        const bodyShopee = {
            category_id: Number(category_id),
            status: Number(status),
            offset: Number(offset),
            page_size: Number(page_size),
            language: language
        };

        console.log("🔹 Shopee Request URL:", url);
        console.log("🔹 Shopee Request Body:", JSON.stringify(bodyShopee, null, 2));

        // 3️⃣ Request ke Shopee
        const response = await axios.post(url, bodyShopee, {
            headers: { "Content-Type": "application/json" },
            validateStatus: () => true // supaya axios tidak throw error untuk status 4xx/5xx
        });

        console.log("🔹 Shopee Response Status:", response.status);
        console.log("🔹 Shopee Response Data:", JSON.stringify(response.data, null, 2));
        console.log("🔹 Shopee Response Headers:", JSON.stringify(response.headers, null, 2));

        // Tangani error_not_found
        if (response.data.error === "error_not_found") {
            return res.status(200).json({
                success: true,
                message: "Kategori valid tapi belum ada brand",
                shopee_response: { brands: [] }
            });
        }

        if (response.data.error) {
            return res.status(400).json({
                success: false,
                message: response.data.message,
                shopee_response: response.data
            });
        }

        return res.status(200).json({
            success: true,
            message: "Brand list retrieved successfully",
            shopee_response: response.data
        });

    } catch (err) {
        console.error("❌ Shopee Get Brand List Error:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mendapatkan brand dari Shopee",
            error: err.response?.data || err.message
        });
    }
};


module.exports = { shopeeCallback, getShopeeItemList, createProductShopee, getShopeeCategories, getShopeeLogistics, getBrandListShopee };
