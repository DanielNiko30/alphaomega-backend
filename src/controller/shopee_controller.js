const crypto = require("crypto");
const https = require("https");

const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
let PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;

// Bersihkan partner key dari whitespace / newline
if (PARTNER_KEY) PARTNER_KEY = PARTNER_KEY.trim();

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
 * Shopee OAuth callback dengan debug lengkap
 */
const shopeeCallback = async (req, res) => {
    try {
        const { code, shop_id, state } = req.query;

        if (!code || !shop_id) {
            return res.status(400).json({ error: "Missing code or shop_id" });
        }

        const shopIdStr = String(shop_id);
        const timestamp = Math.floor(Date.now() / 1000);

        // Coba dua versi path: dengan dan tanpa leading slash
        const paths = ["/api/v2/auth/token/get", "api/v2/auth/token/get"];
        let sign, baseString, selectedPath;

        for (let p of paths) {
            const b = `${PARTNER_ID}${p}${timestamp}${shopIdStr}`;
            const s = crypto.createHmac("sha256", PARTNER_KEY).update(b).digest("hex");
            // Pilih pertama yang valid untuk debug (tidak bisa tahu dulu diterima Shopee atau tidak)
            if (!baseString) {
                baseString = b;
                sign = s;
                selectedPath = p;
            }
        }

        console.log("===== SHOPEE DEBUG =====");
        console.log({
            partner_id: PARTNER_ID,
            timestamp,
            shop_id: shopIdStr,
            baseString,
            generatedSign: sign,
            selectedPath
        });
        console.log("========================");

        const url = `https://partner.shopeemobile.com/${selectedPath}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;

        // Kirim request ke Shopee
        const shopeeResponse = await postJSON(url, {
            code,
            shop_id: shopIdStr,
            partner_id: PARTNER_ID
        });

        console.log("Shopee Response:", shopeeResponse);

        return res.json({
            success: true,
            shop_id: shopIdStr,
            state,
            data: {
                partner_id: PARTNER_ID,
                timestamp,
                baseString,
                generatedSign: sign,
                selectedPath,
                shopee_response: shopeeResponse
            }
        });

    } catch (err) {
        console.error("Shopee Callback Error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
};

module.exports = { shopeeCallback };
