const crypto = require("crypto");
const axios = require("axios");
const { Shopee } = require("../model/shopee_model");

const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
let PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY?.trim();

/**
 * Cek apakah token Shopee sudah expired
 * @param {Shopee} shop
 * @returns {boolean}
 */
function isTokenExpired(shop) {
    const now = Math.floor(Date.now() / 1000);
    const tokenExpireAt = shop.last_updated + shop.expire_in;
    console.log(`[DEBUG] shop_id: ${shop.shop_id} | now: ${now} | last_updated: ${shop.last_updated} | expire_in: ${shop.expire_in} | tokenExpireAt: ${tokenExpireAt}`);
    return now >= tokenExpireAt;
}


/**
 * Refresh token Shopee
 * @param {Shopee} shop
 */
async function refreshShopeeToken(shop) {
    const timestamp = Math.floor(Date.now() / 1000);
    const path = "/api/v2/auth/access_token/get";

    // Signature HMAC
    const baseString = `${PARTNER_ID}${path}${timestamp}`;
    const sign = crypto.createHmac("sha256", PARTNER_KEY).update(baseString).digest("hex");

    const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;

    console.log(`[CRON] 🔄 Refreshing token untuk shop_id: ${shop.shop_id}`);
    console.log(`[CRON] URL refresh: ${url}`);

    try {
        const body = {
            partner_id: PARTNER_ID,
            shop_id: shop.shop_id,
            refresh_token: shop.refresh_token,
        };

        const response = await axios.post(url, body, {
            headers: { "Content-Type": "application/json" },
        });

        console.log("[CRON] Shopee response:", response.data); // ✅ log response

        const data = response.data;


        if (data && data.access_token) {
            await Shopee.update(
                {
                    access_token: data.access_token,
                    refresh_token: data.refresh_token,
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
        console.error("[CRON] ❌ Error refresh token Shopee:", error.response?.data || error.message);
    }
}

module.exports = { isTokenExpired, refreshShopeeToken };
