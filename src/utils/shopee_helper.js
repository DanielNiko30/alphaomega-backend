const axios = require("axios");
const { Shopee } = require("../model/shopee_model");

function isTokenExpired(shop) {
    const now = Math.floor(Date.now() / 1000); // detik
    const lastUpdated = Math.floor(shop.last_updated / 1000); // konversi jika dari milidetik

    return lastUpdated + shop.expire_in <= now;
}

async function refreshShopeeToken(shop) {
    const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
    let PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY?.trim();

    const timestamp = Math.floor(Date.now() / 1000);
    const path = "/api/v2/auth/access_token/get";
    const url = `https://partner.shopeemobile.com${path}`;

    // ✅ Format sign Shopee
    const baseString = `${PARTNER_ID}${path}${timestamp}`;
    const sign = crypto.createHmac("sha256", PARTNER_KEY).update(baseString).digest("hex");

    console.log(`🌐 [REFRESH] Refresh token untuk shop ${shop.shop_id}`);

    const response = await axios.post(url, {
        partner_id: PARTNER_ID,
        shop_id: shop.shop_id,
        refresh_token: shop.refresh_token,
        timestamp,
        sign,
    });

    const data = response.data;
    console.log("[REFRESH] Response dari Shopee:", data);

    if (data && data.access_token) {
        await Shopee.update({
            access_token: data.access_token,
            expire_in: data.expire_in,
            last_updated: Math.floor(Date.now() / 1000),
            refresh_token: data.refresh_token || shop.refresh_token, // kalau Shopee kasih refresh_token baru
        }, {
            where: { shop_id: shop.shop_id },
        });

        console.log(`✅ [REFRESH] Token shop ${shop.shop_id} berhasil diperbarui`);
    } else {
        console.error(`❌ [REFRESH] Gagal refresh token shop ${shop.shop_id}:`, data);
    }
}

module.exports = { isTokenExpired, refreshShopeeToken };
