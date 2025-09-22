const cron = require("node-cron");
const { Shopee } = require("../model/shopee_model");
const { isTokenExpired, refreshShopeeToken } = require("../utils/shopee_helper");

cron.schedule("*/5 * * * *", async () => { // sementara cek tiap 5 menit untuk test
    try {
        console.log("🔄 [CRON] Mengecek Shopee token...", new Date().toISOString());
        const shops = await Shopee.findAll();

        console.log(`📦 [CRON] Total toko ditemukan: ${shops.length}`);

        for (let shop of shops) {
            console.log(`⏳ [CRON] Cek token shop ${shop.shop_id}`);
            if (isTokenExpired(shop)) {
                console.log(`⚠️ [CRON] Token expired untuk shop ${shop.shop_id}, refreshing...`);
                await refreshShopeeToken(shop);
                console.log(`✅ [CRON] Token shop ${shop.shop_id} berhasil di-refresh`);
            } else {
                console.log(`✅ [CRON] Token shop ${shop.shop_id} masih valid`);
            }
        }
    } catch (err) {
        console.error("❌ [CRON] Error Shopee token:", err);
    }
});
