const crypto = require("crypto");
const https = require("https");
const FormData = require("form-data");
const axios = require("axios");
const { QueryTypes } = require("sequelize");
const { Product } = require("../model/product_model");
const { Stok } = require("../model/stok_model");
const { Shopee } = require("../model/shopee_model");
const { getDB } = require("../config/sequelize");
const { HTransJual } = require("../model/htrans_jual_model");
const { DTransJual } = require("../model/dtrans_jual_model");
const { Op } = require("sequelize");


const db = getDB();

const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
let PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;
if (PARTNER_KEY) PARTNER_KEY = PARTNER_KEY.trim();

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

function generateSign(path, timestamp, access_token, shop_id) {
    const baseString = `${PARTNER_ID}${path}${timestamp}${access_token}${shop_id}`;
    return crypto.createHmac("sha256", PARTNER_KEY).update(baseString).digest("hex");
}

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

const getShopeeShippedOrders = async (req, res) => {
    try {
        // Hitung timestamp untuk kemarin + hari ini
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);

        const time_from = Math.floor(yesterday.setHours(0, 0, 0, 0) / 1000);
        const time_to = Math.floor(today.setHours(23, 59, 59, 999) / 1000);

        // Ambil token Shopee
        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token || !shopeeData?.shop_id) {
            return res.status(400).json({
                success: false,
                message: "Shopee token atau shop_id tidak ditemukan di database",
            });
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
            page_size: 50,
            cursor: 0,
            order_status: "PROCESSED", // hanya shipped
        }).toString();

        const url = `https://partner.shopeemobile.com${path}?${params}`;
        const response = await axios.get(url, { headers: { "Content-Type": "application/json" } });

        if (response.data.error) {
            return res.status(400).json({
                success: false,
                message: response.data.message,
                shopee_response: response.data,
            });
        }

        return res.json({
            success: true,
            message: "Berhasil mengambil shipped orders Shopee",
            data: response.data.response,
        });

    } catch (err) {
        console.error("❌ Error getShopeeShippedOrders:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil shipped orders Shopee",
            error: err.response?.data || err.message,
        });
    }
};


const getOrderDetail = async (req, res) => {
    try {
        const { order_sn_list } = req.query;

        if (!order_sn_list) {
            return res.status(400).json({
                success: false,
                message: "order_sn_list wajib dikirim. Pisahkan dengan koma jika lebih dari satu",
            });
        }

        const shop = await Shopee.findOne();
        if (!shop?.access_token || !shop?.shop_id) {
            return res.status(400).json({
                success: false,
                message: "Shopee token atau shop_id tidak ditemukan di database",
            });
        }

        const { shop_id, access_token } = shop;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/order/get_order_detail";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        const BASE_URL = "https://partner.shopeemobile.com";
        const params = new URLSearchParams({
            partner_id: PARTNER_ID,
            timestamp: timestamp,
            access_token: access_token,
            shop_id: shop_id,
            sign: sign,
            order_sn_list: order_sn_list,
            response_optional_fields:
                "buyer_username,item_list,total_amount,recipient_address,package_list",
        });

        const finalUrl = `${BASE_URL}${path}?${params.toString()}`;
        console.log("🔹 FINAL Shopee URL:", finalUrl);

        const response = await axios.get(finalUrl, {
            headers: { "Content-Type": "application/json" },
            validateStatus: () => true,
        });

        if (response.data.error) {
            return res.status(400).json({
                success: false,
                message: response.data.message || "Shopee API Error",
                shopee_response: response.data,
            });
        }

        const orderDetail = response.data.response;
        const orderList = orderDetail?.order_list || [];
        const combinedOrders = [];

        for (const order of orderList) {
            const items = [];

            for (const item of order.item_list || []) {
                const stok = await db.query(
                    `
          SELECT 
            s.id_product_stok,
            s.id_product_shopee,
            s.satuan,
            p.nama_product,
            p.gambar_product
          FROM stok s
          JOIN product p ON p.id_product = s.id_product_stok
          WHERE s.id_product_shopee = :itemId
          LIMIT 1
        `,
                    {
                        replacements: { itemId: String(item.item_id) },
                        type: db.QueryTypes.SELECT,
                    }
                );

                if (stok.length > 0) {
                    const local = stok[0];
                    const gambarBase64 = local.gambar_product
                        ? `data:image/png;base64,${Buffer.from(local.gambar_product).toString("base64")}`
                        : null;

                    items.push({
                        item_id: item.item_id,
                        item_name: item.item_name,
                        variation_name: item.model_name,
                        quantity: item.model_quantity_purchased,
                        price: item.model_discounted_price,
                        from_db: true,
                        id_product_stok: local.id_product_stok,
                        satuan: local.satuan,
                        nama_product: local.nama_product,
                        gambar_product: gambarBase64,
                    });
                } else {
                    items.push({
                        item_id: item.item_id,
                        item_name: item.item_name,
                        variation_name: item.model_name,
                        quantity: item.model_quantity_purchased,
                        price: item.model_discounted_price,
                        from_db: false,
                    });
                }
            }

            // Ambil package_number dari package_list
            const packages = (order.package_list || []).map(pkg => ({
                package_number: pkg.package_number,
                logistics_status: pkg.logistics_status,
                shipping_carrier: pkg.shipping_carrier,
                allow_self_design_awb: pkg.allow_self_design_awb,
            }));

            combinedOrders.push({
                order_sn: order.order_sn,
                buyer_username: order.buyer_username,
                total_amount: order.total_amount,
                status: order.order_status,
                recipient_address: order.recipient_address,
                items: items,
                packages: packages, // ✅ Tambahan
            });
        }

        return res.json({
            success: true,
            message: "Berhasil mengambil detail order Shopee + data lokal (lengkap) termasuk package_number",
            data: combinedOrders,
        });
    } catch (error) {
        console.error("❌ Error getOrderDetail:", error.response?.data || error.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil detail order",
            error: error.response?.data || error.message,
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
        // Ambil token Shopee
        const shop = await Shopee.findOne();
        if (!shop?.access_token || !shop?.shop_id) {
            return res.status(400).json({
                success: false,
                message: "Shopee token atau shop_id tidak ditemukan di database",
            });
        }

        const { shop_id, access_token } = shop;

        // === Panggil API Shopee untuk semua READY_TO_SHIP ===
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/order/get_order_list";
        const sign = generateSign(path, timestamp, access_token, shop_id);
        const BASE_URL = "https://partner.shopeemobile.com";

        // Bisa set time_from ke epoch lama supaya semua order muncul
        const now = Math.floor(Date.now() / 1000);
        const twoDaysAgo = now - 2 * 24 * 60 * 60; // 2 hari ke belakang

        const params = new URLSearchParams({
            partner_id: PARTNER_ID,
            timestamp: now,
            access_token,
            shop_id,
            sign,
            order_status: "READY_TO_SHIP",
            page_size: 100,
            time_range_field: "create_time",
            time_from: twoDaysAgo,
            time_to: now,
        });

        const url = `${BASE_URL}${path}?${params.toString()}`;

        const orderListResp = await axios.get(url, {
            headers: { "Content-Type": "application/json" },
            validateStatus: () => true,
        });

        if (orderListResp.data.error) {
            return res.status(400).json({
                success: false,
                message: orderListResp.data.message || "Shopee API Error",
                shopee_response: orderListResp.data,
            });
        }

        const orderList = orderListResp.data.response?.order_list || [];
        if (orderList.length === 0) {
            return res.json({
                success: true,
                message: "Tidak ada order READY_TO_SHIP",
                data: [],
            });
        }

        const finalOrders = [];

        // Loop setiap order
        for (const order of orderList) {
            const orderSnList = [order.order_sn];
            // Ambil detail order
            const detailPath = "/api/v2/order/get_order_detail";
            const detailSign = generateSign(detailPath, timestamp, access_token, shop_id);
            const detailParams = new URLSearchParams({
                partner_id: PARTNER_ID,
                timestamp,
                access_token,
                shop_id,
                sign: detailSign,
                order_sn_list: order.order_sn,
                response_optional_fields: "buyer_username,item_list,total_amount,recipient_address,package_list",
            });
            const detailUrl = `${BASE_URL}${detailPath}?${detailParams.toString()}`;
            const orderDetailResp = await axios.get(detailUrl, { headers: { "Content-Type": "application/json" } });
            const orderDetail = orderDetailResp.data.response?.order_list?.[0];
            if (!orderDetail?.item_list) continue;

            const items = [];

            for (const item of orderDetail.item_list) {
                // Cek DB lokal
                const stok = await db.query(
                    `
                    SELECT 
                        s.id_product_stok,
                        s.id_product_shopee,
                        s.satuan,
                        p.nama_product,
                        p.gambar_product
                    FROM stok s
                    JOIN product p ON p.id_product = s.id_product_stok
                    WHERE s.id_product_shopee = :itemId
                    LIMIT 1
                    `,
                    {
                        replacements: { itemId: String(item.item_id) },
                        type: db.QueryTypes.SELECT,
                    }
                );

                if (stok.length > 0) {
                    const local = stok[0];
                    const gambarBase64 = local.gambar_product
                        ? `data:image/png;base64,${Buffer.from(local.gambar_product).toString("base64")}`
                        : null;

                    items.push({
                        item_id: item.item_id,
                        item_name: item.item_name,
                        variation_name: item.model_name,
                        quantity: item.model_quantity_purchased,
                        price: item.model_discounted_price,
                        from_db: true,
                        id_product_stok: local.id_product_stok,
                        satuan: local.satuan,
                        namet: local.nama_product,
                        image_url: gambarBase64,
                    });
                } else {
                    items.push({
                        item_id: item.item_id,
                        item_name: item.item_name,
                        variation_name: item.model_name,
                        quantity: item.model_quantity_purchased,
                        price: item.model_discounted_price,
                        from_db: false,
                    });
                }
            }

            finalOrders.push({
                order_sn: order.order_sn,
                buyer_username: order.buyer_username,
                total_amount: order.total_amount,
                status: order.order_status,
                recipient_address: order.recipient_address,
                items: [items[0]],
                full_items: items,
            });
        }

        return res.json({
            success: true,
            message: "Berhasil mengambil semua order READY_TO_SHIP + data lokal",
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

const getShopeeShippedOrdersWithItems = async (req, res) => {
    try {
        // Ambil token Shopee
        const shop = await Shopee.findOne();
        if (!shop?.access_token || !shop?.shop_id) {
            return res.status(400).json({
                success: false,
                message: "Shopee token atau shop_id tidak ditemukan di database",
            });
        }

        const { shop_id, access_token } = shop;

        const BASE_URL = "https://partner.shopeemobile.com";
        const timestamp = Math.floor(Date.now() / 1000);

        // Hitung 2 hari terakhir
        const now = Math.floor(Date.now() / 1000);
        const twoDaysAgo = now - 2 * 24 * 60 * 60;

        // Ambil order PROCESSED (shipped)
        const path = "/api/v2/order/get_order_list";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        const params = new URLSearchParams({
            partner_id: PARTNER_ID,
            timestamp,
            access_token,
            shop_id,
            sign,
            order_status: "PROCESSED",
            page_size: 100,
            time_range_field: "create_time",
            time_from: twoDaysAgo,
            time_to: now,
        });

        const url = `${BASE_URL}${path}?${params.toString()}`;
        const orderListResp = await axios.get(url, {
            headers: { "Content-Type": "application/json" },
        });

        if (orderListResp.data.error) {
            return res.status(400).json({
                success: false,
                message: orderListResp.data.message || "Shopee API Error",
                shopee_response: orderListResp.data,
            });
        }

        const orderList = orderListResp.data.response?.order_list || [];
        if (orderList.length === 0) {
            return res.json({
                success: true,
                message: "Tidak ada order SHIPPED",
                data: [],
            });
        }

        const finalOrders = [];

        for (const order of orderList) {
            // Ambil detail order
            const detailPath = "/api/v2/order/get_order_detail";
            const detailSign = generateSign(detailPath, timestamp, access_token, shop_id);
            const detailParams = new URLSearchParams({
                partner_id: PARTNER_ID,
                timestamp,
                access_token,
                shop_id,
                sign: detailSign,
                order_sn_list: order.order_sn,
                response_optional_fields: "buyer_username,item_list,total_amount,recipient_address,package_list",
            });

            const detailUrl = `${BASE_URL}${detailPath}?${detailParams.toString()}`;
            const orderDetailResp = await axios.get(detailUrl, { headers: { "Content-Type": "application/json" } });
            const orderDetail = orderDetailResp.data.response?.order_list?.[0];
            if (!orderDetail?.item_list) continue;

            const items = [];

            for (const item of orderDetail.item_list) {
                // Cek DB lokal
                const stok = await db.query(
                    `
                    SELECT 
                        s.id_product_stok,
                        s.id_product_shopee,
                        s.satuan,
                        p.nama_product,
                        p.gambar_product
                    FROM stok s
                    JOIN product p ON p.id_product = s.id_product_stok
                    WHERE s.id_product_shopee = :itemId
                    LIMIT 1
                    `,
                    {
                        replacements: { itemId: String(item.item_id) },
                        type: QueryTypes.SELECT,
                    }
                );

                if (stok.length > 0) {
                    const local = stok[0];
                    const gambarBase64 = local.gambar_product
                        ? `data:image/png;base64,${Buffer.from(local.gambar_product).toString("base64")}`
                        : null;

                    items.push({
                        item_id: item.item_id,
                        item_name: item.item_name,
                        variation_name: item.model_name,
                        quantity: item.model_quantity_purchased,
                        price: item.model_discounted_price,
                        from_db: true,
                        id_product_stok: local.id_product_stok,
                        satuan: local.satuan,
                        nama_product: local.nama_product,
                        image_url: gambarBase64,
                    });
                } else {
                    items.push({
                        item_id: item.item_id,
                        item_name: item.item_name,
                        variation_name: item.model_name,
                        quantity: item.model_quantity_purchased,
                        price: item.model_discounted_price,
                        from_db: false,
                    });
                }
            }

            finalOrders.push({
                order_sn: order.order_sn,
                buyer_username: order.buyer_username,
                total_amount: order.total_amount,
                status: order.order_status,
                recipient_address: order.recipient_address,
                items: [items[0]],
                full_items: items,
            });
        }

        return res.json({
            success: true,
            message: "Berhasil mengambil semua order SHIPPED + data lokal",
            data: finalOrders,
        });

    } catch (err) {
        console.error("❌ Error getShopeeShippedOrdersWithItems:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil data order SHIPPED",
            error: err.response?.data || err.message,
        });
    }
};

const getShippingParameter = async (req, res) => {
    try {
        const { order_sn } = req.body;

        if (!order_sn) {
            return res.status(400).json({
                success: false,
                message: "Field 'order_sn' wajib dikirim di body request",
            });
        }

        const shopeeData = await Shopee.findOne();
        if (!shopeeData?.access_token) {
            return res.status(400).json({
                success: false,
                message: "Shopee token not found. Please authorize first.",
            });
        }

        const { shop_id, access_token } = shopeeData;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/logistics/get_shipping_parameter";
        const sign = generateSign(path, timestamp, access_token, shop_id);

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}&order_sn=${order_sn}`;

        const response = await axios.get(url);

        if (response.data.error) {
            return res.status(400).json({
                success: false,
                message: response.data.message || "Gagal mendapatkan shipping parameter",
                shopee_response: response.data,
            });
        }

        return res.json({
            success: true,
            data: response.data.response,
        });
    } catch (err) {
        console.error("❌ Error getShippingParameter:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: "Gagal mendapatkan shipping parameter",
            error: err.response?.data || err.message,
        });
    }
};

const setShopeePickup = async (req, res) => {
    try {
        const { order_sn, address_id, package_number, pickup_time_id } = req.body;

        if (!order_sn || !address_id) {
            return res.status(400).json({
                success: false,
                message: "Field 'order_sn' dan 'address_id' wajib diisi",
            });
        }

        // 1️⃣ Ambil detail order dari endpoint kamu
        const detailUrl = `https://tokalphaomegaploso.my.id/api/shopee/order-detail?order_sn_list=${order_sn}`;
        const detailResp = await axios.get(detailUrl, {
            headers: { "Content-Type": "application/json" },
        });

        if (!detailResp.data.success) {
            return res.status(400).json({
                success: false,
                message: detailResp.data.message || "Gagal mengambil detail order dari Shopee",
            });
        }

        const order = detailResp.data.data?.[0];
        if (!order) {
            return res.status(404).json({ success: false, message: "Order tidak ditemukan" });
        }

        // 2️⃣ Cek stok & siapkan item transaksi
        const itemsForTransaction = [];
        const stokTidakCukup = [];

        for (const item of order.items) {
            if (!item.from_db) {
                return res.status(400).json({
                    success: false,
                    message: `Item ${item.item_id} tidak ditemukan di DB lokal`,
                });
            }

            const stock = await Stok.findOne({
                where: { id_product_stok: item.id_product_stok, satuan: item.satuan },
            });

            const jumlahKurangi = item.quantity;

            if (!stock || stock.stok < jumlahKurangi) {
                stokTidakCukup.push({
                    id_produk: item.id_product_stok,
                    satuan: item.satuan,
                    stok_tersedia: stock ? stock.stok : 0,
                    jumlah_diminta: jumlahKurangi,
                });
            } else {
                itemsForTransaction.push({
                    id_produk: item.id_product_stok,
                    satuan: item.satuan,
                    jumlah_barang: jumlahKurangi,
                    harga_satuan: item.price,
                    subtotal: jumlahKurangi * item.price,
                });
            }
        }

        if (stokTidakCukup.length) {
            return res.status(400).json({
                success: false,
                message: "Stok tidak cukup",
                stok_tidak_cukup: stokTidakCukup,
            });
        }

        // 3️⃣ Buat transaksi jual (sementara package_number = null)
        const id_htrans_jual = await generateHTransJualId();
        const nomor_invoice = await generateInvoiceNumber();

        await HTransJual.create({
            id_htrans_jual,
            id_user: "USR001",
            id_user_penjual: "USR001",
            nama_pembeli: order.buyer_username,
            tanggal: new Date(),
            total_harga: Math.floor(order.total_amount),
            metode_pembayaran: "Shopee",
            nomor_invoice,
            order_sn: order.order_sn,
            package_number: null, // ⬅️ di-update setelah dapat dari Shopee
            status: "Pending",
        });

        // 4️⃣ Insert detail transaksi & update stok
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

            const stock = await Stok.findOne({
                where: { id_product_stok: item.id_produk, satuan: item.satuan },
            });
            await stock.update({ stok: stock.stok - item.jumlah_barang });
        }

        // 5️⃣ Panggil Shopee API ship_order (pickup)
        const shopeeData = await Shopee.findOne();
        const { shop_id, access_token } = shopeeData;

        const timestamp = Math.floor(Date.now() / 1000);
        const pathShip = "/api/v2/logistics/ship_order";
        const signShip = generateSign(pathShip, timestamp, access_token, shop_id);

        const urlShip = `https://partner.shopeemobile.com${pathShip}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${signShip}`;

        const payloadShip = {
            order_sn,
            pickup: { address_id },
        };

        if (package_number) payloadShip.package_number = package_number;
        if (pickup_time_id) payloadShip.pickup.pickup_time_id = pickup_time_id;

        const shipResp = await axios.post(urlShip, payloadShip, {
            headers: { "Content-Type": "application/json" },
        });

        if (shipResp.data.error) {
            return res.status(400).json({
                success: false,
                message: "Pickup Shopee gagal",
                shopee_response: shipResp.data,
            });
        }

        // 🔍 Ambil package_number dari response (jika ada)
        const pkgNumber =
            shipResp.data.response?.result_list?.[0]?.package_number ||
            package_number ||
            null;

        // ✅ Update package_number ke HTransJual jika berhasil dapat
        if (pkgNumber) {
            await HTransJual.update(
                { package_number: pkgNumber },
                { where: { id_htrans_jual } }
            );
        }

        // ✅ Return hasil sukses
        return res.json({
            success: true,
            message: "Pickup berhasil dan transaksi jual dibuat",
            invoice: nomor_invoice,
            id_htrans_jual,
            package_number: pkgNumber,
            jumlah_item: itemsForTransaction.length,
            shopee_response: shipResp.data,
        });

    } catch (err) {
        console.error("❌ Error Pickup + Transaksi:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: err.message,
            error: err.response?.data || err.message,
        });
    }
};

const setShopeeDropoff = async (req, res) => {
    try {
        const { order_sn } = req.body;

        if (!order_sn) {
            return res.status(400).json({ success: false, message: "Field 'order_sn' wajib diisi" });
        }

        // 🔍 1️⃣ Cek apakah order sudah pernah dibuat sebelumnya (misal setelah pickup)
        const existingOrder = await HTransJual.findOne({ where: { order_sn } });

        // 2️⃣ Ambil detail order dari endpoint kamu
        const detailUrl = `https://tokalphaomegaploso.my.id/api/shopee/order-detail?order_sn_list=${order_sn}`;
        const detailResp = await axios.get(detailUrl, { headers: { "Content-Type": "application/json" } });

        if (!detailResp.data.success) {
            return res.status(400).json({ success: false, message: detailResp.data.message });
        }

        const order = detailResp.data.data?.[0];
        if (!order) {
            return res.status(400).json({ success: false, message: "Order tidak ditemukan" });
        }

        // 🧮 3️⃣ Cek stok & siapkan detail transaksi (kalau belum ada di DB)
        const itemsForTransaction = [];
        const stokTidakCukup = [];

        if (!existingOrder) {
            for (const item of order.items) {
                if (!item.from_db) {
                    return res.status(400).json({
                        success: false,
                        message: `Item ${item.item_id} tidak ditemukan di DB lokal`
                    });
                }

                const stock = await Stok.findOne({
                    where: { id_product_stok: item.id_product_stok, satuan: item.satuan }
                });

                const jumlahKurangi = item.quantity;

                if (!stock || stock.stok < jumlahKurangi) {
                    stokTidakCukup.push({
                        id_produk: item.id_product_stok,
                        satuan: item.satuan,
                        stok_tersedia: stock ? stock.stok : 0,
                        jumlah_diminta: jumlahKurangi
                    });
                } else {
                    itemsForTransaction.push({
                        id_produk: item.id_product_stok,
                        satuan: item.satuan,
                        jumlah_barang: jumlahKurangi,
                        harga_satuan: item.price,
                        subtotal: jumlahKurangi * item.price,
                    });
                }
            }

            if (stokTidakCukup.length) {
                return res.status(400).json({
                    success: false,
                    message: "Stok tidak cukup",
                    stok_tidak_cukup: stokTidakCukup
                });
            }
        }

        // 🧾 4️⃣ Buat transaksi jual baru kalau belum ada
        let id_htrans_jual, nomor_invoice, package_number;

        if (!existingOrder) {
            id_htrans_jual = await generateHTransJualId();
            nomor_invoice = await generateInvoiceNumber();

            const createdOrder = await HTransJual.create({
                id_htrans_jual,
                id_user: "USR001",
                id_user_penjual: "USR001",
                nama_pembeli: order.buyer_username,
                tanggal: new Date(),
                total_harga: Math.floor(order.total_amount),
                metode_pembayaran: "Shopee",
                nomor_invoice,
                order_sn: order.order_sn,
                package_number: null, // akan diupdate nanti
                status: "Pending",
            });

            // Simpan item dan kurangi stok
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

                const stock = await Stok.findOne({
                    where: { id_product_stok: item.id_produk, satuan: item.satuan }
                });
                await stock.update({ stok: stock.stok - item.jumlah_barang });
            }

            package_number = null;
        } else {
            id_htrans_jual = existingOrder.id_htrans_jual;
            nomor_invoice = existingOrder.nomor_invoice;
            package_number = existingOrder.package_number; // 🟢 ambil dari transaksi pickup sebelumnya
        }

        // 🚚 5️⃣ Panggil Shopee Dropoff
        const shopeeData = await Shopee.findOne();
        const { shop_id, access_token } = shopeeData;
        const timestamp = Math.floor(Date.now() / 1000);
        const pathShip = "/api/v2/logistics/ship_order";
        const signShip = generateSign(pathShip, timestamp, access_token, shop_id);
        const urlShip = `https://partner.shopeemobile.com${pathShip}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${signShip}`;

        const payloadShip = { order_sn, dropoff: { branch_id: null } };
        if (package_number) payloadShip.package_number = package_number;

        const shipResp = await axios.post(urlShip, payloadShip, {
            headers: { "Content-Type": "application/json" }
        });

        if (shipResp.data.error) {
            return res.status(400).json({
                success: false,
                message: "Dropoff Shopee gagal",
                shopee_response: shipResp.data
            });
        }

        // 🧩 6️⃣ Kalau belum ada package_number, ambil dari get_package_list
        if (!package_number) {
            const pathPkg = "/api/v2/order/get_package_list";
            const timestamp2 = Math.floor(Date.now() / 1000);
            const signPkg = generateSign(pathPkg, timestamp2, access_token, shop_id);
            const urlPkg = `https://partner.shopeemobile.com${pathPkg}?partner_id=${PARTNER_ID}&timestamp=${timestamp2}&access_token=${access_token}&shop_id=${shop_id}&sign=${signPkg}&order_sn_list=${order_sn}`;

            const pkgResp = await axios.get(urlPkg, {
                headers: { "Content-Type": "application/json" }
            });

            package_number =
                pkgResp.data.response?.order_list?.[0]?.package_list?.[0]?.package_number || null;

            if (package_number) {
                await HTransJual.update(
                    { package_number },
                    { where: { order_sn } }
                );
            }
        }

        // 🎯 7️⃣ Sukses
        return res.json({
            success: true,
            message: "Dropoff berhasil dan transaksi jual tersimpan",
            invoice: nomor_invoice,
            id_htrans_jual,
            package_number,
        });

    } catch (err) {
        console.error("❌ Error Dropoff + Transaksi:", err.response?.data || err.message);
        return res.status(500).json({
            success: false,
            message: err.message,
            error: err.response?.data || err.message
        });
    }
};

const createBookingShippingDocument = async (req, res) => {
    try {
        const { order_sn } = req.body;
        if (!order_sn) {
            return res.status(400).json({
                success: false,
                message: "Field 'order_sn' wajib diisi",
            });
        }

        // 🔑 Ambil Shopee credentials
        const shop = await Shopee.findOne();
        if (!shop?.access_token || !shop?.shop_id) {
            return res.status(400).json({
                success: false,
                message: "Shopee token atau shop_id tidak ditemukan di database",
            });
        }

        const shop_id = Number(shop.shop_id);
        const access_token = shop.access_token;
        const partner_key = process.env.SHOPEE_PARTNER_KEY;
        const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);

        const timestamp = Math.floor(Date.now() / 1000);

        // 🔹 Fungsi pembuat signature
        const makeSign = (path) =>
            crypto
                .createHmac("sha256", partner_key)
                .update(`${PARTNER_ID}${path}${timestamp}${access_token}${shop_id}`)
                .digest("hex");

        // 1️⃣ Get order detail (cek booking_sn & tracking_number)
        const pathOrderDetail = "/api/v2/order/get_order_detail";
        const signOrderDetail = makeSign(pathOrderDetail);
        const urlOrderDetail = `https://partner.shopeemobile.com${pathOrderDetail}?partner_id=${PARTNER_ID}&shop_id=${shop_id}&timestamp=${timestamp}&access_token=${access_token}&sign=${signOrderDetail}&order_sn_list=${order_sn}&response_optional_fields=package_list,recipient_address`;

        const orderDetailResp = await axios.get(urlOrderDetail, {
            headers: { "Content-Type": "application/json" },
        });

        const orderInfo = orderDetailResp.data.response?.order_list?.[0];
        const packageData = orderInfo?.package_list?.[0];
        const recipientAddress = orderInfo?.recipient_address || {};

        let booking_sn = packageData?.booking_sn;
        let tracking_number = packageData?.tracking_number;

        // 2️⃣ Kalau belum ada booking_sn → otomatis arrange shipment
        if (!booking_sn || !tracking_number) {
            console.log("⚙️ Belum ada booking_sn, arrange shipment dulu...");

            const pathShipBooking = "/api/v2/logistics/ship_booking";
            const signShip = makeSign(pathShipBooking);
            const urlShip = `https://partner.shopeemobile.com${pathShipBooking}?partner_id=${PARTNER_ID}&shop_id=${shop_id}&timestamp=${timestamp}&access_token=${access_token}&sign=${signShip}`;

            const shipResp = await axios.post(
                urlShip,
                { order_sn_list: [order_sn] },
                { headers: { "Content-Type": "application/json" }, validateStatus: () => true }
            );

            if (shipResp.data.error) {
                return res.status(400).json({
                    success: false,
                    message: shipResp.data.message || "Gagal arrange shipment (ship_booking)",
                    data: shipResp.data,
                });
            }

            // 🔄 Ambil ulang order detail untuk dapat booking_sn & tracking_number
            const recheckResp = await axios.get(urlOrderDetail, {
                headers: { "Content-Type": "application/json" },
            });
            const recheckInfo = recheckResp.data.response?.order_list?.[0];
            const recheckPackage = recheckInfo?.package_list?.[0];
            booking_sn = recheckPackage?.booking_sn;
            tracking_number = recheckPackage?.tracking_number;

            if (!booking_sn || !tracking_number) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Arrange shipment berhasil tapi belum dapat booking_sn/tracking_number. Tunggu sebentar lalu coba lagi.",
                });
            }
        }

        // 3️⃣ Buat dokumen resi (create_booking_shipping_document)
        const pathCreate = "/api/v2/logistics/create_booking_shipping_document";
        const signCreate = makeSign(pathCreate);
        const urlCreate = `https://partner.shopeemobile.com${pathCreate}?partner_id=${PARTNER_ID}&shop_id=${shop_id}&timestamp=${timestamp}&access_token=${access_token}&sign=${signCreate}`;

        const createResp = await axios.post(
            urlCreate,
            {
                booking_list: [
                    {
                        booking_sn,
                        tracking_number,
                        shipping_document_type: "NORMAL_AIR_WAYBILL",
                    },
                ],
            },
            { headers: { "Content-Type": "application/json" } }
        );

        if (createResp.data.error) {
            return res.status(400).json({
                success: false,
                message: createResp.data.message || "Gagal membuat shipping document",
                data: createResp.data,
            });
        }

        // 4️⃣ Ambil hasil file resi
        const pathResult = "/api/v2/logistics/get_booking_shipping_document_result";
        const signResult = makeSign(pathResult);
        const urlResult = `https://partner.shopeemobile.com${pathResult}?partner_id=${PARTNER_ID}&shop_id=${shop_id}&timestamp=${timestamp}&access_token=${access_token}&sign=${signResult}&booking_sn_list=${booking_sn}`;

        const resultResp = await axios.get(urlResult, {
            headers: { "Content-Type": "application/json" },
        });

        const fileUrl = resultResp.data.response?.result_list?.[0]?.file_url;
        if (!fileUrl) {
            return res.status(400).json({
                success: false,
                message: "Tidak ditemukan file URL resi dari Shopee.",
                data: resultResp.data,
            });
        }

        // 5️⃣ Download PDF resi
        const pdfResponse = await axios.get(fileUrl, { responseType: "arraybuffer" });

        const outputDir = path.join(__dirname, "../resi");
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

        const filePath = path.join(outputDir, `resi_${order_sn}.pdf`);
        fs.writeFileSync(filePath, pdfResponse.data);

        return res.json({
            success: true,
            message: "Berhasil arrange shipment + generate & download resi",
            order_sn,
            booking_sn,
            tracking_number,
            recipient_address: recipientAddress,
            file_path: `/resi/resi_${order_sn}.pdf`,
            file_url: fileUrl,
        });
    } catch (error) {
        console.error("❌ Error createBookingShippingDocument:", error.response?.data || error.message);
        return res.status(500).json({
            success: false,
            message: "Gagal membuat booking shipping document",
            error: error.response?.data || error.message,
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
    getShopeeShippedOrders,
    getOrderDetail,
    searchShopeeProductByName,
    getShopeeOrdersWithItems,
    getShopeeShippedOrdersWithItems,
    getShippingParameter,
    setShopeePickup,
    createBookingShippingDocument,
    setShopeeDropoff
};
