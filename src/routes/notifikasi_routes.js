const express = require('express');
const router = express.Router();
const axios = require('axios');

// 🔐 OneSignal credentials (disarankan pakai .env nanti)
const ONESIGNAL_APP_ID = "257845e8-86e4-466e-b8cb-df95a1005a5f";
const ONESIGNAL_API_KEY = "os_v2_app_ev4el2eg4rdg5ogl36k2cac2l77dtzxyewue2anofcau7i6isuunhmxqf2gty4ootqcrprhfqfgrmk3onnr6mjzf273ll2oz3rgtwiy"; // ⚠️ Ganti dengan REST API Key dari OneSignal dashboard

/**
 * 📤 POST /api/notification/send
 * Mengirim notifikasi ke semua pengguna (segment 'All')
 */
router.post('/send', async (req, res) => {
    try {
        // Ambil data dari body request
        const { title, message } = req.body;
        const notifTitle = title || "Notifikasi Baru";
        const notifMessage = message || "Terdapat pembaruan baru di sistem!";

        console.log("📦 Mengirim notifikasi ke OneSignal...");
        console.log("Title:", notifTitle);
        console.log("Message:", notifMessage);

        // Kirim request ke OneSignal API
        const response = await axios.post(
            "https://onesignal.com/api/v1/notifications",
            {
                app_id: ONESIGNAL_APP_ID,
                headings: { en: notifTitle },
                contents: { en: notifMessage },
                included_segments: ["All"], // Kirim ke semua user
                android_visibility: 1,
                android_sound: "cashier",
                priority: 10,
            },
            {
                headers: {
                    "Authorization": `Basic ${ONESIGNAL_API_KEY}`,
                    "Content-Type": "application/json",
                },
            }
        );

        // ✅ Sukses kirim
        console.log("✅ Notifikasi berhasil dikirim!");
        res.json({
            success: true,
            message: "✅ Notifikasi berhasil dikirim!",
            data: {
                id: response.data.id,
                external_id: response.data.external_id,
            },
        });
    } catch (err) {
        // ❌ Gagal kirim
        console.error("❌ OneSignal Error:");
        if (err.response) {
            console.error("Status:", err.response.status);
            console.error("Data:", err.response.data);
        } else {
            console.error(err.message);
        }

        res.status(500).json({
            success: false,
            error: err.response?.data || err.message,
        });
    }
});

module.exports = router;
