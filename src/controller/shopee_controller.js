const crypto = require("crypto");
const https = require("https");
const { Shopee } = require("../model/shopee_model"); // Import model

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

        // ✅ Jika sukses, simpan ke DB
        if (shopeeResponse.access_token && shopeeResponse.refresh_token) {
            // Hapus semua data lama
            await Shopee.destroy({ where: {} });

            // Simpan data token terbaru
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
        // Ambil token terbaru dari database
        const shopeeData = await Shopee.findOne();
        if (!shopeeData || !shopeeData.access_token) {
            return res.status(400).json({ error: "Shopee token not found. Please authorize first." });
        }

        const { shop_id, access_token } = shopeeData;

        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/product/get_item_list";

        // Generate signature
        const sign = generateSign(path, timestamp, access_token, shop_id);

        // Build URL ke Shopee
        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}&offset=0&page_size=10&item_status=NORMAL`;

        console.log("Shopee Get Item List URL:", url);

        // Request GET ke Shopee API
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

module.exports = { shopeeCallback, getShopeeItemList };