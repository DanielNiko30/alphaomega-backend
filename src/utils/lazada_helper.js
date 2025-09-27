const axios = require("axios");
const { Lazada } = require("../model/lazada_model");

/**
 * Cek apakah access_token Lazada sudah expired
 * @param {Lazada} lazadaData
 * @returns {boolean}
 */
function isLazadaTokenExpired(lazadaData) {
    const now = Math.floor(Date.now() / 1000);
    const expireAt = lazadaData.last_updated + lazadaData.expires_in;

    console.log(`[LAZADA DEBUG] now: ${now} | expireAt: ${expireAt} | expires_in: ${lazadaData.expires_in}`);
    return now >= expireAt;
}

/**
 * Refresh token Lazada
 */
async function refreshLazadaToken() {
    try {
        const CLIENT_ID = process.env.LAZADA_APP_KEY;
        const CLIENT_SECRET = process.env.LAZADA_APP_SECRET;

        const lazadaData = await Lazada.findOne();
        if (!lazadaData) {
            console.error("[LAZADA CRON] ❌ Tidak ada data token Lazada di database");
            return;
        }

        // Jika token belum expired, tidak perlu refresh
        if (!isLazadaTokenExpired(lazadaData)) {
            console.log("[LAZADA CRON] ✅ Token masih aktif, tidak perlu refresh");
            return;
        }

        console.log("[LAZADA CRON] 🔄 Token expired, melakukan refresh...");

        const url = `https://auth.lazada.com/rest/auth/token/refresh?app_key=${CLIENT_ID}`;

        const body = new URLSearchParams({
            app_secret: CLIENT_SECRET,
            refresh_token: lazadaData.refresh_token
        });

        const response = await axios.post(url, body, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const tokenData = response.data;

        if (tokenData.access_token) {
            await lazadaData.update({
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token || lazadaData.refresh_token,
                expires_in: tokenData.expires_in,
                last_updated: Math.floor(Date.now() / 1000)
            });

            console.log(`[LAZADA CRON] ✅ Token Lazada berhasil di-refresh untuk account: ${lazadaData.account}`);
        } else {
            console.error("[LAZADA CRON] ❌ Gagal refresh token Lazada:", tokenData);
        }
    } catch (err) {
        console.error("[LAZADA CRON] ❌ Error saat refresh token Lazada:", err.response?.data || err.message);
    }
}

module.exports = {
    isLazadaTokenExpired,
    refreshLazadaToken
};
