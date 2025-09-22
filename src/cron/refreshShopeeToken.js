const cron = require("node-cron");
console.log("[CRON] 🔹 Cron job file loaded"); // ✅ log pasti muncul

cron.schedule("*/1 * * * *", async () => { // test setiap 1 menit dulu
    console.log("[CRON] 🔹 Cron tick:", new Date().toISOString());

    try {
        const shops = await Shopee.findAll();
        console.log("[CRON] 🔹 Shops found:", shops.length);

        for (let shop of shops) {
            console.log(`[CRON] Checking shop_id: ${shop.shop_id}`);
        }
    } catch (err) {
        console.error("[CRON ERROR]", err.message);
    }
});
