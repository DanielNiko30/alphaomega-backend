const crypto = require("crypto");

const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;
const REDIRECT_URL = process.env.SHOPEE_REDIRECT_URL;

const shopeeCallback = async (req, res) => {
    try {
        const { code, shop_id, state } = req.query;

        if (!code || !shop_id) {
            return res.status(400).json({ error: "Missing code or shop_id" });
        }

        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/auth/token/get";

        // 🔑 Buat sign sesuai dokumentasi Shopee
        const baseString = `${PARTNER_ID}${path}${timestamp}`;
        const sign = crypto
            .createHmac("sha256", PARTNER_KEY)
            .update(baseString)
            .digest("hex");

        // 🔄 Debug log
        console.log("===== SHOPEE DEBUG =====");
        console.log("Partner ID:", PARTNER_ID);
        console.log("Partner Key (first 6 chars):", PARTNER_KEY?.substring(0, 6));
        console.log("Timestamp:", timestamp);
        console.log("Path:", path);
        console.log("BaseString:", baseString);
        console.log("Generated Sign:", sign);
        console.log("========================");

        // 🔄 Request ke Shopee API
        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;
        console.log("Request URL:", url);

        const tokenRes = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                code,
                shop_id: Number(shop_id),
                partner_id: PARTNER_ID,
            }),
        });

        const data = await tokenRes.json();

        return res.json({
            success: true,
            shop_id,
            state,
            data,
        });
    } catch (err) {
        console.error("Shopee Callback Error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
};

module.exports = { shopeeCallback };
