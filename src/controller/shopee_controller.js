const crypto = require("crypto");

const PARTNER_ID = process.env.SHOPEE_PARTNER_ID;
const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;
const REDIRECT_URL = process.env.SHOPEE_REDIRECT_URL;
// contoh: https://tokalphaomegaploso.my.id/api/shopee/callback

// ✅ Callback dari Shopee setelah authorize
const shopeeCallback = async (req, res) => {
    try {
        const { code, shop_id, state } = req.query;

        if (!code || !shop_id) {
            return res.status(400).json({ error: "Missing code or shop_id" });
        }

        // 🔑 Buat timestamp & sign
        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/auth/token/get";
        const baseString = `${PARTNER_ID}${path}${timestamp}`;
        const sign = crypto
            .createHmac("sha256", PARTNER_KEY)
            .update(baseString)
            .digest("hex");

        // 🔄 Tukar code jadi access_token
        const tokenRes = await fetch(
            `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code,
                    shop_id: Number(shop_id),
                    partner_id: Number(PARTNER_ID),
                }),
            }
        );

        const data = await tokenRes.json();

        if (data.error) {
            return res.status(400).json({ error: data });
        }

        // ✅ Simpan token di DB (nanti kamu buat model ShopeeToken)
        // await ShopeeToken.upsert({
        //   shop_id,
        //   access_token: data.access_token,
        //   refresh_token: data.refresh_token,
        //   expire_in: Date.now() + data.expire_in * 1000,
        // });

        return res.json({
            success: true,
            message: "Shopee authorization success",
            shop_id,
            state,
            token_data: data,
        });
    } catch (err) {
        console.error("Shopee Callback Error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
};

module.exports = { shopeeCallback };
