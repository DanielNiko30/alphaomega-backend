const crypto = require("crypto");

const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;

const shopeeCallback = async (req, res) => {
    try {
        const { code, shop_id, state } = req.query;

        if (!code || !shop_id) {
            return res.status(400).json({ error: "Missing code or shop_id" });
        }

        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/auth/token/get";

        // ✅ BaseString TANPA shop_id
        const baseString = `${PARTNER_ID}${path}${timestamp}`;
        const sign = crypto
            .createHmac("sha256", PARTNER_KEY)
            .update(baseString)
            .digest("hex");

        console.log("===== SHOPEE DEBUG =====");
        console.log("Partner ID:", PARTNER_ID);
        console.log("Partner Key Length:", PARTNER_KEY?.length);
        console.log("Partner Key (first 8):", PARTNER_KEY?.substring(0, 8));
        console.log("Timestamp:", timestamp);
        console.log("Path:", path);
        console.log("Shop ID:", shop_id);
        console.log("BaseString:", baseString);
        console.log("Generated Sign:", sign);
        console.log("========================");

        // 🔗 URL (tanpa shop_id di query!)
        const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;
        console.log("Request URL:", url);

        // 🚀 Request ke Shopee API
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
        console.log("Shopee Response:", data);

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
