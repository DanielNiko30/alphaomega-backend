const cron = require("node-cron");
const { Shopee } = require("../model/shopee_model");
const { isTokenExpired, refreshShopeeToken } = require("../utils/shopee_helper");

/**
 * CRON untuk cek token Shopee
 * - Setiap 4 jam akan dicek otomatis
 * - Jika expired, langsung refresh token
 */
cron.schedule("0 */4 * * *", async () => {
    console.log(`[CRON] Cek token Shopee... ${new Date().toISOString()}`);

    try {
        const shops = await Shopee.findAll();

        for (let shop of shops) {
            console.log(`[CRON] Shop ID ${shop.shop_id} | last_updated: ${shop.last_updated}, expire_in: ${shop.expire_in}`);

            if (isTokenExpired(shop)) {
                console.log(`[CRON] Token expired! Mulai refresh...`);
                await refreshShopeeToken(shop);
            } else {
                console.log(`[CRON] Token masih aktif ✅`);
            }
        }
    } catch (err) {
        console.error(`[CRON ERROR]`, err.message);
    }
});
