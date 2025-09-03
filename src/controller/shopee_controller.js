const crypto = require("crypto");
const https = require("https");

const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
let PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY?.trim();

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
        const { code, shop_id } = req.query;

        if (!code || !shop_id) {
            return res.status(400).json({ error: "Missing code or shop_id" });
        }

        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/auth/token/get";

        // BaseString
        const baseString = `${PARTNER_ID}${path}${timestamp}${shop_id}`;

        console.log("===== DEBUG SIGNATURE =====");
        console.log({
            partner_id: PARTNER_ID,
            path,
            timestamp,
            shop_id,
            baseString,
            key_length: PARTNER_KEY.length,
        });

        const sign = crypto.createHmac("sha256", PARTNER_KEY)
            .update(baseString)
            .digest("hex");

        console.log("Generated Sign:", sign);

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;

        const body = { code, shop_id, partner_id: PARTNER_ID };
        console.log("POST URL:", url);
        console.log("POST BODY:", body);

        const shopeeResponse = await postJSON(url, body);

        return res.json({ success: true, shop_id, shopee_response: shopeeResponse });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
};

module.exports = { shopeeCallback };
