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
    try {
        const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
        let PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;
        if (PARTNER_KEY) PARTNER_KEY = PARTNER_KEY.trim();

        const timestamp = Math.floor(Date.now() / 1000);
        const path = "/api/v2/auth/access_token/get";
        const url = `https://partner.shopeemobile.com${path}`;

        // Base string untuk sign
        const baseString = `${PARTNER_ID}${path}${timestamp}${shop.refresh_token}`;
        const sign = crypto.createHmac("sha256", PARTNER_KEY)
            .update(baseString)
            .digest("hex");

        console.log(`[REFRESH] Mulai refresh token untuk Shop ID ${shop.shop_id}`);

        // Request ke Shopee
        const response = await axios.post(url, {
            partner_id: PARTNER_ID,
            refresh_token: shop.refresh_token,
            timestamp,
            sign
        });

        const data = response.data;
        console.log(`[REFRESH RESPONSE]`, JSON.stringify(data, null, 2));

        // Validasi response
        if (data.error) {
            throw new Error(`Shopee error: ${data.error} - ${data.message}`);
        }

        if (!data.access_token || !data.refresh_token) {
            throw new Error("Response Shopee tidak mengandung token baru.");
        }

        // Update ke database
        await Shopee.update(
            {
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                expire_in: data.expire_in,
                last_updated: Math.floor(Date.now() / 1000),
            },
            { where: { shop_id: shop.shop_id } }
        );

        console.log(`[REFRESH SUCCESS] Token Shopee untuk Shop ID ${shop.shop_id} berhasil di-refresh ✅`);
        return data.access_token;

    } catch (err) {
        console.error(`[REFRESH ERROR] Gagal refresh token untuk Shop ID ${shop.shop_id}: ${err.message}`);
        throw err;
    }
}

module.exports = {
    isTokenExpired,
    refreshShopeeToken,
};
