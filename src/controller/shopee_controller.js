const crypto = require("crypto");

// 🔑 Ganti dengan Live Partner ID & Key
const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID) || 2012319;
const PARTNER_KEY =
    process.env.SHOPEE_PARTNER_KEY ||
    "shpk70754d646e53645a4450504e7a5a716871715a4c5877416647776555494f";
const REDIRECT_URL = process.env.SHOPEE_REDIRECT_URL;

const shopeeCallback = async (req, res) => {
    try {
        const { code, shop_id, state } = req.query;

        if (!code || !shop_id) {
            return res.status(400).json({ error: "Missing code or shop_id" });
        }

        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/auth/token/get";

        // ✅ BaseString untuk sign HARUS ada partner_id, path, timestamp, dan shop_id
        const baseString = `${PARTNER_ID}${path}${timestamp}${shop_id}`;
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
        console.log("Shop ID:", shop_id);
        console.log("BaseString:", baseString);
        console.log("Generated Sign:", sign);
        console.log("========================");

        // 🔗 URL API Shopee
        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}&shop_id=${shop_id}`;
        console.log("Request URL:", url);

        // 🔄 Request ke Shopee API
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
