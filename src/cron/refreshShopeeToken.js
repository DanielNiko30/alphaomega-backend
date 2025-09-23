const cron = require("node-cron");
const { Shopee } = require("../model/shopee_model");
const { isTokenExpired, refreshShopeeToken } = require("../utils/shopee_helper");

console.log("[CRON] 🔹 Cron job file loaded");

cron.schedule("*/1 * * * *", async () => { // setiap 1 menit untuk test
    console.log("[CRON] 🔹 Cron tick:", new Date().toISOString());

    try {
        const shops = await Shopee.findAll();
        console.log("[CRON] 🔹 Shops found:", shops.length);

        for (let shop of shops) {
            console.log(`[CRON] Checking shop_id: ${shop.shop_id}`);

            if (isTokenExpired(shop)) {
                console.log(`[CRON] Token expired for shop_id: ${shop.shop_id} -> refreshing...`);

                try {
                    await refreshShopeeToken(shop);
                } catch (err) {
                    console.error(`[CRON] ❌ Error calling refreshShopeeToken for shop_id ${shop.shop_id}:`, err.message);
                }
            } else {
                console.log(`[CRON] Token still active ✅ for shop_id: ${shop.shop_id}`);
            }
        }
    } catch (err) {
        console.error("[CRON ERROR]", err.message);
    }
});
