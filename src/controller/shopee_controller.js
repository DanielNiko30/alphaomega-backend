const crypto = require("crypto");
const https = require("https");

// Ambil partner_id & partner_key dari .env
const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
let PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;

// Bersihkan partner key dari whitespace/newline
if (PARTNER_KEY) PARTNER_KEY = PARTNER_KEY.trim();

/**
 * Helper POST JSON
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

/**
 * Callback Shopee OAuth
 */
const shopeeCallback = async (req, res) => {
    try {
        // ======== FULL DEBUG START ========
        console.log("===== FULL DEBUG START =====");

        console.log("ENV VARIABLES:");
        console.log({
            SHOPEE_PARTNER_ID: process.env.SHOPEE_PARTNER_ID,
            SHOPEE_PARTNER_KEY_RAW: process.env.SHOPEE_PARTNER_KEY,
            SHOPEE_PARTNER_KEY_JSON: JSON.stringify(process.env.SHOPEE_PARTNER_KEY),
            SHOPEE_PARTNER_KEY_TRIMMED: JSON.stringify(PARTNER_KEY),
            key_length_raw: process.env.SHOPEE_PARTNER_KEY?.length,
            key_length_trimmed: PARTNER_KEY?.length
        });

        console.log("QUERY RECEIVED FROM SHOPEE:");
        console.log(req.query);

        const { code, shop_id, state } = req.query;

        if (!code || !shop_id) {
            console.error("❌ Missing code or shop_id");
            return res.status(400).json({ error: "Missing code or shop_id" });
        }

        // Shopee sangat sensitif waktu
        const timestamp = Math.floor(Date.now() / 1000);
        console.log("SERVER TIMESTAMP:", timestamp, "| Local Date:", new Date(timestamp * 1000).toISOString());

        // Pastikan path benar dan persis sesuai dokumen
        const path = "/api/v2/auth/token/get";

        // BaseString format sesuai dokumentasi:
        // partner_id + path + timestamp + shop_id
        const baseString = `${PARTNER_ID}${path}${timestamp}${shop_id}`;
        console.log("BASESTRING DEBUG:");
        console.log({
            partner_id: PARTNER_ID,
            path,
            timestamp,
            shop_id,
            baseString,
            baseString_length: baseString.length
        });

        // Generate signature
        const sign = crypto
            .createHmac("sha256", PARTNER_KEY)
            .update(baseString)
            .digest("hex");

        console.log("SIGNATURE DEBUG:");
        console.log({
            generatedSign: sign,
            sign_length: sign.length
        });

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;

        const body = {
            code,
            shop_id,
            partner_id: PARTNER_ID,
        };

        console.log("FINAL REQUEST TO SHOPEE:");
        console.log({ url, body });

        // ======== CALL SHOPEE ========
        let shopeeResponse;
        try {
            shopeeResponse = await postJSON(url, body);
        } catch (err) {
            console.error("❌ Error posting to Shopee:", err.message);
            shopeeResponse = { error: "post_error", message: err.message };
        }

        console.log("SHOPEE RAW RESPONSE:");
        console.log(shopeeResponse);
        console.log("===== FULL DEBUG END =====");

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
                shopee_response: shopeeResponse
            },
        });
    } catch (err) {
        console.error("❌ Shopee Callback Error:", err);
        return res.status(500).json({
            error: "Internal server error",
            message: err.message,
        });
    }
};

module.exports = { shopeeCallback };
