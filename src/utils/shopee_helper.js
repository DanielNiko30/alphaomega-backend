const axios = require("axios");
const crypto = require("crypto");
const { Shopee } = require("../model/shopee_model");

/**
 * Cek apakah token sudah expired
 */
function isTokenExpired(shop) {
    if (!shop?.last_updated || !shop?.expire_in) return true;
    const now = Math.floor(Date.now() / 1000);
    const tokenExpireAt = shop.last_updated + shop.expire_in;
    return now >= tokenExpireAt;
}

/**
 * Refresh token Shopee untuk 1 shop
 */
async function refreshShopeeToken(shop) {
    if (!shop?.shop_id || !shop?.refresh_token) {
        console.error("[CRON] ❌ Shop data tidak lengkap:", shop);
        return false;
    }

    const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
    const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY?.trim();
    if (!PARTNER_ID || !PARTNER_KEY) {
        console.error("[CRON] ❌ PARTNER_ID atau PARTNER_KEY belum di-set di env");
        return false;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const path = "/api/v2/auth/access_token/get";
    const sign = crypto.createHmac("sha256", PARTNER_KEY)
        .update(`${PARTNER_ID}${path}${timestamp}`)
        .digest("hex");

    const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;
    const body = { partner_id: PARTNER_ID, shop_id: shop.shop_id, refresh_token: shop.refresh_token };

    console.log(`[CRON] 🔄 Refresh token untuk shop_id: ${shop.shop_id}`);
    console.log(`[CRON] URL: ${url}`);
    console.log(`[CRON] Body:`, body);

    try {
        const response = await axios.post(url, body, {
            headers: { "Content-Type": "application/json" },
            timeout: 10000
        });

        const data = response.data;
        console.log("[CRON] Shopee response:", data);

        if (data?.access_token) {
            await Shopee.update(
                {
                    access_token: data.access_token,
                    refresh_token: data.refresh_token,
                    expire_in: data.expire_in,
                    last_updated: timestamp,
                },
                { where: { shop_id: shop.shop_id } }
            );
            console.log(`[CRON] ✅ Token berhasil diperbarui untuk shop_id: ${shop.shop_id}`);
            return true;
        } else {
            console.error("[CRON] ❌ Gagal refresh token, response invalid:", data);
            return false;
        }
    } catch (err) {
        console.error("[CRON] ❌ Error refresh token:", err.response?.data || err.message);
        return false;
    }
}

/**
 * Refresh token semua shop
 */
async function refreshAllShopeeTokens() {
    try {
        const shops = await Shopee.findAll();
        for (const shop of shops) {
            if (isTokenExpired(shop)) {
                console.log(`[CRON] Token expired untuk shop_id: ${shop.shop_id}`);
                await refreshShopeeToken(shop);
            } else {
                console.log(`[CRON] Token masih aktif untuk shop_id: ${shop.shop_id}`);
            }
        }
    } catch (err) {
        console.error("[CRON] ❌ Error fetch shops:", err.message);
    }
}

module.exports = {
    isTokenExpired,
    refreshShopeeToken,
    refreshAllShopeeTokens
};
