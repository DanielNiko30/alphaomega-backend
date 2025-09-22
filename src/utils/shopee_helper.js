const axios = require("axios");
const crypto = require("crypto");
const { Shopee } = require("../model/shopee_model");

/**
 * Mengecek apakah token sudah expired
 */
function isTokenExpired(shop) {
    const now = Math.floor(Date.now() / 1000); // detik
    const tokenExpireAt = shop.last_updated + shop.expire_in;
    return now >= tokenExpireAt;
}

/**
 * Refresh token Shopee
 */
async function refreshShopeeToken(shop) {
    const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
    const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY?.trim();

    const timestamp = Math.floor(Date.now() / 1000);
    const path = "/api/v2/auth/access_token/get";

    // 🔹 Buat signature HMAC
    const baseString = `${PARTNER_ID}${path}${timestamp}`;
    const sign = crypto.createHmac("sha256", PARTNER_KEY).update(baseString).digest("hex");

    // 🔹 URL query string
    const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;

    console.log(`[CRON] 🔄 Refreshing token untuk shop_id: ${shop.shop_id}`);
    console.log(`[CRON] URL refresh: ${url}`);

    try {
        // Body harus lengkap: partner_id, shop_id, refresh_token
        const body = {
            partner_id: PARTNER_ID,
            shop_id: shop.shop_id,
            refresh_token: shop.refresh_token,
        };

        console.log("[CRON] Request body:", body);

        const response = await axios.post(url, body, {
            headers: { "Content-Type": "application/json" },
        });

        console.log("[CRON] Shopee Refresh Response:", response.data);

        const data = response.data;

        if (data && data.access_token) {
            // ✅ Simpan token baru ke DB
            await Shopee.update(
                {
                    access_token: data.access_token,
                    refresh_token: data.refresh_token, // refresh_token baru
                    expire_in: data.expire_in,
                    last_updated: Math.floor(Date.now() / 1000),
                },
                { where: { shop_id: shop.shop_id } }
            );
            console.log(`[CRON] ✅ Token baru berhasil disimpan untuk shop_id: ${shop.shop_id}`);
        } else {
            console.error("[CRON] ❌ Gagal refresh token Shopee:", data);
        }
    } catch (error) {
        console.error("[CRON] ❌ Error saat refresh token Shopee:", error.response?.data || error.message);
    }
}

module.exports = {
    isTokenExpired,
    refreshShopeeToken,
};
