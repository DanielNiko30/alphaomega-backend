const crypto = require("crypto");
const https = require("https");
const { Shopee } = require("../model/shopee_model"); // import model Sequelize Shopee

const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
let PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY?.trim();

/**
 * Fungsi POST JSON menggunakan https bawaan Node
 * @param {string} url 
 * @param {object} body 
 * @returns {Promise<object>}
 */
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
            res.on("data", (chunk) => chunks += chunk);
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

/**
 * Shopee OAuth callback
 * @route GET /api/shopee/callback
 */
const shopeeCallback = async (req, res) => {
    try {
        const { code, shop_id, state } = req.query;

        console.log("===== SHOPEE CALLBACK RECEIVED =====");
        console.log({ code, shop_id, state, partner_key_length: PARTNER_KEY?.length });
        console.log("===================================");

        if (!code || !shop_id) {
            return res.status(400).json({ error: "Missing code or shop_id" });
        }

        const shopIdStr = shop_id;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/auth/token/get"; // leading slash wajib

        // BaseString = partner_id + path + timestamp + shop_id
        const baseString = `${PARTNER_ID}${path}${timestamp}${shopIdStr}`;
        const sign = crypto.createHmac("sha256", PARTNER_KEY).update(baseString).digest("hex");

        console.log("===== DEBUG SIGNATURE =====");
        console.log({ timestamp, path, baseString, generatedSign: sign, shopIdStr });
        console.log("============================");

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;
        console.log("POST URL:", url);
        console.log("POST Body:", { code, shop_id: shopIdStr, partner_id: PARTNER_ID });

        let shopeeResponse;
        try {
            shopeeResponse = await postJSON(url, {
                code,
                shop_id: shopIdStr,
                partner_id: PARTNER_ID
            });
        } catch (err) {
            console.error("Error posting to Shopee:", err.message);
            shopeeResponse = { error: "post_error", message: err.message };
        }

        console.log("Shopee Response:", shopeeResponse);

        // Simpan ke database jika ada access_token
        if (shopeeResponse.access_token && shopeeResponse.refresh_token) {
            try {
                await Shopee.upsert({
                    shop_id: BigInt(shopIdStr),
                    access_token: shopeeResponse.access_token,
                    refresh_token: shopeeResponse.refresh_token,
                    expire_in: shopeeResponse.expire_in,
                    last_updated: Math.floor(Date.now() / 1000)
                });
                console.log("✅ Shopee token berhasil disimpan/diupdate di DB");
            } catch (dbErr) {
                console.error("❌ Gagal simpan token Shopee ke DB:", dbErr.message);
            }
        }

        return res.json({
            success: true,
            shop_id: shopIdStr,
            state,
            data: {
                partner_id: PARTNER_ID,
                timestamp,
                baseString,
                generatedSign: sign,
                url,
                shopee_response: shopeeResponse
            }
        });

    } catch (err) {
        console.error("Shopee Callback Error:", err);
        return res.status(500).json({ error: "Internal server error", message: err.message });
    }
};

module.exports = { shopeeCallback };
