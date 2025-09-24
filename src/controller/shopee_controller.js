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
        const { weight, category_id, dimension, condition, item_sku, brand_id, brand_name, selected_unit, logistic_id } = req.body;

        // 1️⃣ Ambil token Shopee
        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token) {
            return res.status(400).json({ error: "Shopee token not found. Please authorize first." });
        }
        const { shop_id, access_token } = shopeeData;

        // 2️⃣ Ambil data produk + stok
        const product = await Product.findOne({
            where: { id_product },
            include: [{ model: Stok, as: "stok" }],
        });
        if (!product) return res.status(404).json({ error: "Produk tidak ditemukan" });
        if (!product.gambar_product) return res.status(400).json({ error: "Produk tidak memiliki gambar!" });

        // 3️⃣ Pilih stok sesuai satuan
        const stokTerpilih = selected_unit
            ? product.stok.find(s => s.satuan === selected_unit)
            : product.stok[0];
        if (!stokTerpilih) return res.status(400).json({ error: `Stok untuk satuan ${selected_unit} tidak ditemukan` });

        // 4️⃣ Upload gambar
        const timestamp = Math.floor(Date.now() / 1000);
        const uploadPath = "/api/v2/media_space/upload_image";
        const uploadSign = generateSign(uploadPath, timestamp, access_token, shop_id);
        const uploadUrl = `https://partner.shopeemobile.com${uploadPath}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${uploadSign}`;
        const imageBuffer = Buffer.isBuffer(product.gambar_product) ? product.gambar_product : Buffer.from(product.gambar_product);

        const formData = new FormData();
        formData.append("image", imageBuffer, { filename: `${product.id_product}.png`, contentType: "image/png" });
        const uploadResponse = await axios.post(uploadUrl, formData, { headers: formData.getHeaders() });
        const uploadedImageId = uploadResponse.data?.response?.image_info?.image_id;
        if (!uploadedImageId) return res.status(400).json({ error: "Gagal mendapatkan image_id dari Shopee", shopee_response: uploadResponse.data });

        // 5️⃣ Body Add Item dengan logistic_id dari request
        if (!logistic_id) return res.status(400).json({ error: "logistic_id wajib diisi" });

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
                    logistic_id: Number(logistic_id), // dari request
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

        // ✅ Simpan id_product_shopee di tabel Stok sesuai satuan
        const newShopeeId = createResponse.data.response?.item_id;
        if (newShopeeId) {
            await Stok.update(
                { id_product_shopee: newShopeeId },
                { where: { id_stok: stokTerpilih.id_stok } }
            );
        }

        return res.status(201).json({
            success: true,
            message: "Produk berhasil ditambahkan ke Shopee",
            shopee_response: createResponse.data,
            updated_stock: {
                id_stok: stokTerpilih.id_stok,
                satuan: stokTerpilih.satuan,
                id_product_shopee: newShopeeId
            }
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

const updateProductShopee = async (req, res) => {
    try {
        const { id_product } = req.params;
        const { weight, category_id, dimension, condition, item_sku, brand_id, brand_name, selected_unit, logistic_id } = req.body;

        // 1️⃣ Ambil token Shopee
        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token) {
            return res.status(400).json({ error: "Shopee token not found. Please authorize first." });
        }
        const { shop_id, access_token } = shopeeData;

        // 2️⃣ Ambil data produk + stok
        const product = await Product.findOne({
            where: { id_product },
            include: [{ model: Stok, as: "stok" }],
        });

        if (!product) return res.status(404).json({ error: "Produk tidak ditemukan" });

        // 3️⃣ Pilih stok sesuai satuan
        const stokTerpilih = selected_unit
            ? product.stok.find(s => s.satuan === selected_unit)
            : product.stok[0];

        if (!stokTerpilih) return res.status(400).json({ error: `Stok untuk satuan ${selected_unit} tidak ditemukan` });

        if (!stokTerpilih.id_product_shopee) {
            return res.status(400).json({ error: "Produk ini belum memiliki id_product_shopee, silakan add_item terlebih dahulu." });
        }

        // 4️⃣ Upload gambar (optional: jika user ingin ganti gambar baru)
        let uploadedImageId = null;
        if (product.gambar_product) {
            const timestamp = Math.floor(Date.now() / 1000);
            const uploadPath = "/api/v2/media_space/upload_image";
            const uploadSign = generateSign(uploadPath, timestamp, access_token, shop_id);
            const uploadUrl = `https://partner.shopeemobile.com${uploadPath}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${uploadSign}`;

            const imageBuffer = Buffer.isBuffer(product.gambar_product) ? product.gambar_product : Buffer.from(product.gambar_product);
            const formData = new FormData();
            formData.append("image", imageBuffer, {
                filename: `${product.id_product}.png`,
                contentType: "image/png"
            });

            const uploadResponse = await axios.post(uploadUrl, formData, { headers: formData.getHeaders() });
            uploadedImageId = uploadResponse.data?.response?.image_info?.image_id || null;

            if (!uploadedImageId) {
                return res.status(400).json({ error: "Gagal upload image ke Shopee", shopee_response: uploadResponse.data });
            }
        }

        // 5️⃣ Body Update Item
        if (!logistic_id) return res.status(400).json({ error: "logistic_id wajib diisi" });

        const body = {
            item_id: Number(stokTerpilih.id_product_shopee), // ID produk di Shopee
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
                    logistic_id: Number(logistic_id), // mask_channel_id diambil dari frontend
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
            brand: { brand_id: Number(brand_id) || 0, original_brand_name: brand_name || "No Brand" }
        };

        // Tambahkan gambar jika ada perubahan
        if (uploadedImageId) {
            body.image = { image_id_list: [uploadedImageId], image_ratio: "1:1" };
        }

        // 6️⃣ Request ke Shopee Update API
        const timestamp = Math.floor(Date.now() / 1000);
        const updatePath = "/api/v2/product/update_item";
        const updateSign = generateSign(updatePath, timestamp, access_token, shop_id);
        const updateUrl = `https://partner.shopeemobile.com${updatePath}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${updateSign}`;

        const updateResponse = await axios.post(updateUrl, body, {
            headers: { "Content-Type": "application/json" }
        });

        if (updateResponse.data.error) {
            return res.status(400).json({
                success: false,
                message: updateResponse.data.message,
                shopee_response: updateResponse.data
            });
        }

        return res.status(200).json({
            success: true,
            message: "Produk berhasil diupdate di Shopee",
            shopee_response: updateResponse.data,
            updated_stock: {
                id_stok: stokTerpilih.id_stok,
                satuan: stokTerpilih.satuan,
                id_product_shopee: stokTerpilih.id_product_shopee
            }
        });

    } catch (err) {
        console.error("❌ Shopee Update Product Error:", err.response?.data || err.message);
        return res.status(500).json({ error: err.response?.data || err.message, message: "Gagal update produk di Shopee." });
    }
};

const getShopeeItemInfo = async (req, res) => {
    try {
        const { id_product } = req.params;
        const { satuan } = req.body; // satuan wajib dikirim di body

        // 1️⃣ Validasi satuan wajib
        if (!satuan) {
            return res.status(400).json({
                success: false,
                message: "Field 'satuan' wajib dikirim di body request",
            });
        }

        // 2️⃣ Ambil data Shopee (token & shop_id)
        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token) {
            return res.status(400).json({
                success: false,
                message: "Shopee token tidak ditemukan. Harap authorize ulang.",
            });
        }
        const { shop_id, access_token } = shopeeData;

        // 3️⃣ Ambil data produk + stok sesuai satuan
        const product = await Product.findOne({
            where: { id_product },
            include: [{ model: Stok, as: "stok" }],
        });

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Produk tidak ditemukan di database lokal",
            });
        }

        const stokTerpilih = product.stok.find((s) => s.satuan === satuan);

        if (!stokTerpilih) {
            return res.status(404).json({
                success: false,
                message: `Stok dengan satuan '${satuan}' tidak ditemukan untuk produk ini`,
            });
        }

        if (!stokTerpilih.id_product_shopee) {
            return res.status(400).json({
                success: false,
                message: `Produk dengan satuan '${satuan}' belum memiliki id_product_shopee. Tidak dapat mengambil data Shopee.`,
            });
        }

        const item_id = stokTerpilih.id_product_shopee;

        // 4️⃣ Buat signature untuk request Shopee
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/product/get_item_base_info";

        const sign = generateSign(path, timestamp, access_token, shop_id);

        const url = `https://partner.shopeemobile.com${path}?partner_id=${process.env.SHOPEE_PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}&item_id_list=${item_id}&need_tax_info=false&need_complaint_policy=false`;

        console.log("🔹 Shopee Get Item Info URL:", url);

        // 5️⃣ Request ke Shopee
        const response = await axios.get(url, {
            headers: { "Content-Type": "application/json" },
        });

        if (response.data.error) {
            return res.status(400).json({
                success: false,
                message: response.data.message,
                shopee_response: response.data,
            });
        }

        const item = response.data.response?.item_list?.[0];
        if (!item) {
            return res.status(404).json({
                success: false,
                message: "Data produk Shopee tidak ditemukan",
                shopee_response: response.data,
            });
        }

        // 6️⃣ Ambil field yang dibutuhkan untuk frontend
        const result = {
            item_id: item.item_id,
            weight: item.weight,
            category_id: item.category_id,
            length: item.package_length,
            width: item.package_width,
            height: item.package_height,
            condition: item.condition,
            item_sku: item.item_sku,
            brand_name: item.brand?.original_brand_name || "No Brand",
        };

        return res.json({
            success: true,
            data: result,
            raw_response: response.data,
        });
    } catch (err) {
        console.error("❌ Shopee Get Item Info Error:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil informasi produk dari Shopee",
            error: err.response?.data || err.message,
        });
    }
};

const getShopeeOrders = async (req, res) => {
    try {
        const {
            time_range_field = "create_time",
            page_size = 20,
            cursor = "",
            order_status = "READY_TO_SHIP"
        } = req.query;

        // Hitung timestamp hari ini (awal dan akhir)
        const now = new Date();
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 hari sebelumnya

        const time_from = Math.floor(oneWeekAgo.getTime() / 1000);
        const time_to = Math.floor(now.getTime() / 1000);

        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token) {
            return res.status(400).json({ error: "Shopee token not found. Please authorize first." });
        }

        const { shop_id, access_token } = shopeeData;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/order/get_order_list";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        const params = new URLSearchParams({
            partner_id: PARTNER_ID,
            timestamp,
            access_token,
            shop_id,
            sign,
            time_range_field: "create_time",
            time_from,
            time_to,
            page_size,
            cursor,
            order_status
        }).toString();

        const url = `https://partner.shopeemobile.com${path}?${params}`;

        const response = await axios.get(url, { headers: { "Content-Type": "application/json" } });

        if (response.data.error) {
            return res.status(400).json({ success: false, message: response.data.message, shopee_response: response.data });
        }

        return res.json({ success: true, data: response.data.response });

    } catch (err) {
        console.error("❌ Shopee Get Orders Error:", err.response?.data || err.message);
        return res.status(500).json({ success: false, message: "Gagal mengambil pesanan Shopee", error: err.response?.data || err.message });
    }
};

const setShopeePickup = async (req, res) => {
    try {
        const { order_list } = req.body;

        if (!order_list || !Array.isArray(order_list) || order_list.length === 0) {
            return res.status(400).json({ success: false, message: "Field 'order_list' wajib diisi dan tidak boleh kosong" });
        }

        if (order_list.length > 50) {
            return res.status(400).json({ success: false, message: "Maksimal 50 order dalam 1 request" });
        }

        // 1️⃣ Ambil token Shopee
        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token) {
            return res.status(400).json({ success: false, message: "Shopee token tidak ditemukan. Harap authorize ulang." });
        }

        const { shop_id, access_token } = shopeeData;

        // 2️⃣ Generate signature & URL
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/logistics/create_shipping_document";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}`;

        console.log("🔹 Shopee Create Shipping Document URL:", url);
        console.log("🔹 Body:", JSON.stringify({ order_list }, null, 2));

        // 3️⃣ Request ke Shopee
        const response = await axios.post(url, { order_list }, {
            headers: { "Content-Type": "application/json" },
            validateStatus: () => true
        });

        // 4️⃣ Tangani response
        if (response.data.error) {
            return res.status(400).json({
                success: false,
                message: response.data.message || "Gagal membuat shipping document",
                shopee_response: response.data
            });
        }

        return res.status(200).json({
            success: true,
            message: "Shipping document / pickup berhasil dibuat",
            shopee_response: response.data
        });

    } catch (err) {
        console.error("❌ Shopee Set Pickup Error:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal membuat shipping document / atur pickup",
            error: err.response?.data || err.message
        });
    }
};

const getOrderDetail = async (req, res) => {
    try {
        const { order_sn_list } = req.query;

        // Validasi input
        if (!order_sn_list) {
            return res.status(400).json({
                success: false,
                message: "order_sn_list wajib dikirim. Pisahkan dengan koma jika lebih dari satu"
            });
        }

        // Ambil token Shopee
        const shop = await Shopee.findOne();
        if (!shop?.access_token || !shop?.shop_id) {
            return res.status(400).json({
                success: false,
                message: "Shopee token atau shop_id tidak ditemukan di database"
            });
        }

        const { shop_id, access_token } = shop;

        // Generate sign
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/order/get_order_detail";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        // Build URL Shopee
        const BASE_URL = "https://partner.shopeemobile.com";
        const params = new URLSearchParams({
            partner_id: PARTNER_ID,
            timestamp: timestamp,
            access_token: access_token,
            shop_id: shop_id,
            sign: sign,
            order_sn_list: order_sn_list, // jangan encode manual, URLSearchParams yang handle
            response_optional_fields: "buyer_username,item_list,total_amount,recipient_address,package_list"
        });

        const finalUrl = `${BASE_URL}${path}?${params.toString()}`;

        console.log("🔹 FINAL Shopee URL:", finalUrl);

        // Call Shopee API
        const response = await axios.get(finalUrl, {
            headers: { "Content-Type": "application/json" },
            validateStatus: () => true
        });

        console.log("🔹 Shopee RESPONSE:", JSON.stringify(response.data, null, 2));

        // Jika Shopee return error
        if (response.data.error) {
            return res.status(400).json({
                success: false,
                message: response.data.message || "Shopee API Error",
                shopee_response: response.data
            });
        }

        return res.json({
            success: true,
            data: response.data.response
        });

    } catch (error) {
        console.error("❌ Error getOrderDetail:", error.response?.data || error.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil detail order",
            error: error.response?.data || error.message
        });
    }
};

const searchShopeeProductByName = async (req, res) => {
    try {
        const { keyword = "", offset = 0, page_size = 50 } = req.query;

        // 1️⃣ Ambil data Shopee token
        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token) {
            return res.status(400).json({
                success: false,
                message: "Shopee token tidak ditemukan. Harap authorize ulang."
            });
        }

        const { shop_id, access_token } = shopeeData;

        // 2️⃣ Generate sign
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/product/get_item_list";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        // 3️⃣ Panggil get_item_list dengan offset & page_size
        const listUrl = `https://partner.shopeemobile.com${path}?partner_id=${process.env.SHOPEE_PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}&offset=${offset}&page_size=${page_size}&item_status=NORMAL`;

        const listResponse = await axios.get(listUrl, {
            headers: { "Content-Type": "application/json" },
        });

        const items = listResponse.data.response?.item || [];
        if (items.length === 0) {
            return res.json({
                success: true,
                message: "Tidak ada produk ditemukan di Shopee.",
                data: [],
                pagination: {
                    offset: Number(offset),
                    page_size: Number(page_size),
                    total_count: 0
                }
            });
        }

        // 4️⃣ Ambil detail produk pakai get_item_base_info (maks 50 per request)
        const detailPath = "/api/v2/product/get_item_base_info";
        const detailSign = generateSign(detailPath, timestamp, access_token, shop_id);

        const itemIds = items.map(i => i.item_id).slice(0, 50).join(",");

        const detailUrl = `https://partner.shopeemobile.com${detailPath}?partner_id=${process.env.SHOPEE_PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${detailSign}&item_id_list=${itemIds}`;

        const detailResponse = await axios.get(detailUrl, {
            headers: { "Content-Type": "application/json" },
        });

        const detailItems = detailResponse.data.response?.item_list || [];

        // 5️⃣ Filter produk berdasarkan keyword (case-insensitive)
        const filteredItems = detailItems.filter(item =>
            item.item_name?.toLowerCase().includes(keyword.toLowerCase())
        );

        return res.json({
            success: true,
            message: "Data produk berhasil diambil",
            data: filteredItems,
            pagination: {
                offset: Number(offset),
                page_size: Number(page_size),
                total_count: listResponse.data.response?.total_count || 0,
                has_next_page: listResponse.data.response?.has_next_page || false
            }
        });

    } catch (err) {
        console.error("❌ Shopee Search Item Error:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil data produk Shopee",
            error: err.response?.data || err.message,
        });
    }
};

const getShopeeOrdersWithItems = async (req, res) => {
    try {
        // 1️⃣ Ambil daftar order dari Shopee
        const orderListResp = await axios.get(
            "https://tokalphaomegaploso.my.id/api/shopee/orders?page_size=20&order_status=READY_TO_SHIP"
        );

        const orderList = orderListResp.data?.data?.order_list || [];
        if (orderList.length === 0) {
            return res.json({
                success: true,
                message: "Tidak ada order Shopee yang ditemukan",
                data: [],
            });
        }

        const finalOrders = [];

        // 2️⃣ Loop setiap order → ambil detail dan mapping item
        for (const order of orderList) {
            // Ambil detail per order
            const orderDetailResp = await axios.get(
                `https://tokalphaomegaploso.my.id/api/shopee/order-detail?order_sn_list=${order.order_sn}`
            );

            const orderDetail = orderDetailResp.data?.data?.order_list?.[0];
            if (!orderDetail?.item_list) continue;

            const items = [];

            // 3️⃣ Loop setiap item dalam order
            for (const item of orderDetail.item_list) {
                // Query ke DB lokal untuk cek apakah produk ada
                const stok = await db.query(
                    `
                    SELECT 
                        s.id_product_stok AS id_product,
                        s.id_product_shopee,
                        p.nama_product,
                        p.gambar_product
                    FROM stok s
                    JOIN product p ON p.id_product = s.id_product_stok
                    WHERE s.id_product_shopee = :itemId
                    LIMIT 1
                    `,
                    {
                        replacements: { itemId: item.item_id },
                        type: QueryTypes.SELECT,
                    }
                );

                if (stok.length > 0) {
                    // ✅ Produk ditemukan di DB lokal → gunakan data dari DB
                    const gambarBase64 = stok[0].gambar_product
                        ? `data:image/png;base64,${Buffer.from(stok[0].gambar_product).toString("base64")}`
                        : null;

                    items.push({
                        item_id: item.item_id,
                        name: stok[0].nama_product,
                        image_url: gambarBase64,
                        variation_name: item.model_name, // model_name dari Shopee
                        quantity: item.model_quantity_purchased,
                        price: item.model_discounted_price,
                        from_db: true,
                    });
                } else {
                    // ❌ Produk tidak ditemukan → ambil dari Shopee API item-info
                    const productInfoResp = await axios.post(
                        `https://tokalphaomegaploso.my.id/api/shopee/product/item-info/${item.item_id}`,
                        { satuan: item.model_name } // body wajib
                    );

                    const productInfo = productInfoResp.data?.data;

                    items.push({
                        item_id: item.item_id,
                        name: productInfo?.name || "Produk Tidak Diketahui",
                        image_url: productInfo?.image || null,
                        variation_name: item.model_name,
                        quantity: item.model_quantity_purchased,
                        price: item.model_discounted_price,
                        from_db: false,
                    });
                }
            }

            // 4️⃣ Simpan data order → hanya tampilkan 1 item pertama untuk list
            finalOrders.push({
                order_sn: order.order_sn,
                buyer_username: order.buyer_username,
                status: order.order_status,
                total_amount: order.total_amount,
                shipping_method: order.package_list?.[0]?.shipping_carrier || "",
                create_time: order.create_time,
                items: [
                    {
                        ...items[0], // tampilkan hanya 1 item pertama
                    },
                ],
                full_items: items, // semua item lengkap untuk detail
            });
        }

        return res.json({
            success: true,
            message: "Berhasil mengambil data order Shopee",
            data: finalOrders,
        });
    } catch (err) {
        console.error("❌ Error getShopeeOrdersWithItems:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil data order Shopee",
            error: err.response?.data || err.message,
        });
    }
};

module.exports = {
    shopeeCallback,
    getShopeeItemList,
    createProductShopee,
    getShopeeCategories,
    getShopeeLogistics,
    getBrandListShopee,
    updateProductShopee,
    getShopeeItemInfo,
    getShopeeOrders,
    setShopeePickup,
    getOrderDetail,
    searchShopeeProductByName,
    getShopeeOrdersWithItems
};
