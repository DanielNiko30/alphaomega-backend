const cron = require("node-cron");
const { Shopee } = require("../model/shopee_model"); // sesuaikan path model
const { isTokenExpired, refreshShopeeToken } = require("../utils/shopee_helper"); // helper untuk cek & refresh token

// Cron job: setiap 4 jam
cron.schedule("0 */4 * * *", async () => {
    try {
        console.log("🔄 Mengecek Shopee token...");
        const shops = await Shopee.findAll();
        for (let shop of shops) {
            if (isTokenExpired(shop)) {
                await refreshShopeeToken(shop);
                console.log(`✅ Token Shopee shop ${shop.shop_id} berhasil di-refresh`);
            }
        }
    } catch (err) {
        console.error("❌ Error cron Shopee token:", err.message);
    }
});
