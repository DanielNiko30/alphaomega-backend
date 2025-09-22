const axios = require("axios");
const crypto = require("crypto");
const { Shopee } = require("../model/shopee_model");

/**
 * Fungsi untuk mengecek apakah token sudah expired
 * @param {Object} shop - data dari tabel shopee_routes
 * @returns {boolean}
 */
function isTokenExpired(shop) {
    const now = Math.floor(Date.now() / 1000); // detik
    const tokenExpireAt = shop.last_updated + shop.expire_in;
    return now >= tokenExpireAt;
}

/**
 * Fungsi untuk refresh token Shopee
 * @param {Object} shop - data shop dari database
 */
async function refreshShopeeToken(shop) {
    const PARTNER_ID = process.env.SHOPEE_PARTNER_ID;
    let PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;
    if (PARTNER_KEY) PARTNER_KEY = PARTNER_KEY.trim();

    const timestamp = Math.floor(Date.now() / 1000);
    const path = "/api/v2/auth/access_token/get"; // endpoint Shopee untuk refresh token
    const url = `https://partner.shopeemobile.com${path}`;

    // HMAC untuk tanda tangan (sign)
    const baseString = `${PARTNER_ID}${path}${timestamp}${shop.refresh_token}`;
    const sign = crypto.createHmac("sha256", PARTNER_KEY).update(baseString).digest("hex");

    console.log(`[CRON] 🔄 Refreshing token untuk shop_id: ${shop.shop_id}`);

    try {
        const response = await axios.post(url, {
            partner_id: Number(PARTNER_ID),
            refresh_token: shop.refresh_token,
            shop_id: shop.shop_id,
            timestamp,
            sign
        });

        const data = response.data;
        console.log("[CRON] Shopee Refresh Response:", data);

        // Validasi apakah response sukses
        if (data && data.access_token) {
            await Shopee.update(
                {
                    access_token: data.access_token,
                    refresh_token: data.refresh_token, // update refresh token juga
                    expire_in: data.expire_in,
                    last_updated: Math.floor(Date.now() / 1000) // simpan waktu sekarang
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
