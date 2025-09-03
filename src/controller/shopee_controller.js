const crypto = require("crypto");
const https = require("https");
const { Shopee } = require("../model/shopee_model");

const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY?.trim();

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

const shopeeCallback = async (req, res) => {
    try {
        const { code, shop_id, state } = req.query;

        if (!code || !shop_id) {
            return res.status(400).json({ error: "Missing code or shop_id" });
        }

        const shopIdStr = shop_id;
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/auth/token/get";

        // ✅ Generate Signature
        const baseString = `${PARTNER_ID}${path}${timestamp}${shopIdStr}`;
        const sign = crypto
            .createHmac("sha256", PARTNER_KEY)
            .update(baseString)
            .digest("hex");

        // Debug untuk validasi
        console.log("===== SHOPEE DEBUG =====");
        console.log("Partner ID:", PARTNER_ID);
        console.log("Timestamp:", timestamp);
        console.log("Path:", path);
        console.log("Shop ID:", shopIdStr);
        console.log("BaseString:", baseString);
        console.log("Partner Key Length:", PARTNER_KEY.length);
        console.log("Generated Sign:", sign);

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;

        let shopeeResponse;
        try {
            shopeeResponse = await postJSON(url, {
                code,
                shop_id: shopIdStr,
                partner_id: PARTNER_ID
            });
        } catch (err) {
            console.error("Error posting to Shopee:", err.message);
            return res.status(500).json({ error: "Shopee API Error", message: err.message });
        }

        // ✅ Simpan token hanya jika Shopee memberikan access_token & refresh_token
        if (shopeeResponse.access_token && shopeeResponse.refresh_token) {
            try {
                await Shopee.upsert({
                    shop_id: BigInt(shopIdStr), // PK → otomatis replace jika sudah ada
                    access_token: shopeeResponse.access_token,
                    refresh_token: shopeeResponse.refresh_token,
                    expire_in: shopeeResponse.expire_in,
                    last_updated: Math.floor(Date.now() / 1000)
                });
                console.log(`✅ Token Shopee untuk shop_id ${shopIdStr} berhasil disimpan / diperbarui`);
            } catch (dbErr) {
                console.error("❌ Gagal menyimpan token Shopee ke DB:", dbErr.message);
            }
        } else {
            console.error("❌ Shopee tidak mengirimkan access_token:", JSON.stringify(shopeeResponse));
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
