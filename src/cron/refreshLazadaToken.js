const cron = require("node-cron");
const { refreshLazadaToken } = require("../utils/lazada_helper");

console.log("[LAZADA CRON] 🔹 Cron job Lazada loaded");

// Jalankan setiap hari jam 00:00 (tengah malam)
cron.schedule("0 0 * * *", async () => {
    console.log("[LAZADA CRON] 🔹 Running token refresh job:", new Date().toISOString());
    await refreshLazadaToken();
});

// Untuk testing, bisa pakai setiap 5 menit
cron.schedule("*/5 * * * *", async () => {
    console.log("[LAZADA CRON TEST] 🔹 Running every 5 minutes:", new Date().toISOString());
    await refreshLazadaToken();
});
