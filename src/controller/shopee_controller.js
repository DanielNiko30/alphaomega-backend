const crypto = require("crypto");
const https = require("https");
const { Shopee } = require("../model/shopee_model"); // Pastikan model sudah benar

const PARTNER_ID = process.env.SHOPEE_PARTNER_ID.trim();
const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY.trim();

/**
 * Helper untuk POST JSON ke Shopee
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
                    const json = JSON.parse(chunks);
                    resolve(json);
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
 * Callback setelah Shopee redirect ke server kita
 * Proses:
 * 1. Ambil code & shop_id dari query
 * 2. Generate sign dengan format yang benar
 * 3. Hit Shopee endpoint /api/v2/auth/token/get
 * 4. Simpan access_token & refresh_token ke database
 */
const shopeeCallback = async (req, res) => {
    try {
        console.log("===== DEBUG CALLBACK QUERY =====");
        console.log("Full URL:", req.originalUrl);
        console.log("Query Params:", req.query);

        // Decode `code` dan `shop_id` untuk memastikan karakter lengkap
        const code = decodeURIComponent(req.query.code || "");
        const shop_id = req.query.shop_id || "";

        if (!code || !shop_id) {
            return res.status(400).json({ error: "Missing code or shop_id" });
        }

        if (code.length < 32) {
            console.error("❌ Code dari Shopee tidak lengkap:", code);
            return res.status(400).json({
                error: "Invalid Shopee code",
                message: "Code tidak lengkap. Pastikan middleware Express sudah benar",
            });
        }

        // Pastikan middleware sudah benar
        // app.use(express.urlencoded({ extended: true }))

        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/auth/token/get";

        /**
         * SIGN untuk token/get:
         * baseString = partner_id + path + timestamp + code + shop_id
         */
        const baseString = `${PARTNER_ID}${path}${timestamp}${code}${shop_id}`;
        const sign = crypto
            .createHmac("sha256", PARTNER_KEY)
            .update(baseString, "utf8")
            .digest("hex");

        console.log("===== SHOPEE SIGN DEBUG =====");
        console.log({
            PARTNER_ID,
            path,
            timestamp,
            code,
            shop_id,
            baseString,
            generatedSign: sign,
        });
        console.log("Partner Key Length:", PARTNER_KEY.length);

        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;

        // Body yang dikirim ke Shopee
        const body = {
            code,
            shop_id,
            partner_id: Number(PARTNER_ID),
        };

        console.log("Request Body to Shopee:", body);
        console.log("Request URL:", url);

        // 🔹 Request ke Shopee untuk exchange code jadi token
        const shopeeResponse = await postJSON(url, body);

        console.log("===== SHOPEE RESPONSE =====");
        console.log(shopeeResponse);

        // ✅ Jika Shopee mengembalikan token
        if (shopeeResponse.access_token && shopeeResponse.refresh_token) {
            await Shopee.upsert({
                shop_id: BigInt(shop_id),
                access_token: shopeeResponse.access_token,
                refresh_token: shopeeResponse.refresh_token,
                expire_in: shopeeResponse.expire_in,
                last_updated: timestamp,
            });

            console.log(`✅ Token Shopee untuk shop_id ${shop_id} berhasil disimpan`);

            return res.json({
                success: true,
                message: "Shopee token berhasil diterima dan disimpan",
                shop_id,
                data: {
                    access_token: shopeeResponse.access_token,
                    refresh_token: shopeeResponse.refresh_token,
                    expire_in: shopeeResponse.expire_in,
                    timestamp,
                },
            });
        } else {
            console.error("❌ Shopee tidak mengirim access_token:", shopeeResponse);
            return res.status(400).json({
                success: false,
                error: "Shopee tidak mengirim access_token",
                shopee_response: shopeeResponse,
            });
        }
    } catch (err) {
        console.error("Shopee Callback Error:", err);
        return res.status(500).json({
            error: "Internal server error",
            message: err.message,
        });
    }
};

module.exports = { shopeeCallback };
