const cron = require("node-cron");
const { Shopee } = require("../model/shopee_model");
const { isTokenExpired, refreshShopeeToken } = require("../utils/shopee_helper");

cron.schedule("0 */4 * * *", async () => {
    console.log(`[CRON] Cek token Shopee... ${new Date().toISOString()}`);
    try {
        const shops = await Shopee.findAll();
        for (let shop of shops) {
            if (isTokenExpired(shop)) {
                console.log(`[CRON] Token expired! Refreshing...`);
                await refreshShopeeToken(shop);
            } else {
                console.log(`[CRON] Token masih aktif ✅`);
            }
        }
    } catch (err) {
        console.error("[CRON ERROR]", err.message);
    }
});
