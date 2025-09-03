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

const shopeeCallback = async (req, res) => {
    try {
        const { code, shop_id, state } = req.query;

        if (!code || !shop_id) {
            return res.status(400).json({ error: "Missing code or shop_id" });
        }

        const shopIdNum = Number(shop_id); // pastikan angka
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/auth/token/get";

        /**
         * ✅ SIGN yang benar untuk token/get
         * partner_id + path + timestamp + code + shop_id
         */
        const baseString = `${PARTNER_ID}${path}${timestamp}${code}${shopIdNum}`;
        const sign = crypto
            .createHmac("sha256", PARTNER_KEY)
            .update(baseString, "utf8")
            .digest("hex");

        console.log("===== SHOPEE DEBUG =====");
        console.log("BaseString:", baseString);
        console.log("Generated Sign:", sign);
        console.log("Partner Key Length:", PARTNER_KEY.length);

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;

        console.log("Request Body to Shopee:", {
            code,
            shop_id: shopIdNum,
            partner_id: PARTNER_ID,
        });

        // 🔹 Request ke Shopee
        const shopeeResponse = await postJSON(url, {
            code,
            shop_id: shopIdNum,
            partner_id: PARTNER_ID,
        });

        console.log("Shopee Response:", shopeeResponse);

        // ✅ Simpan token jika berhasil
        if (shopeeResponse.access_token && shopeeResponse.refresh_token) {
            await Shopee.upsert({
                shop_id: BigInt(shopIdNum),
                access_token: shopeeResponse.access_token,
                refresh_token: shopeeResponse.refresh_token,
                expire_in: shopeeResponse.expire_in,
                last_updated: timestamp,
            });
            console.log(`✅ Token Shopee untuk shop_id ${shopIdNum} berhasil disimpan`);
        } else {
            console.error("❌ Shopee tidak mengirim access_token:", shopeeResponse);
        }

        return res.json({
            success: true,
            shop_id: shopIdNum,
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
        return res
            .status(500)
            .json({ error: "Internal server error", message: err.message });
    }
};

module.exports = { shopeeCallback };
