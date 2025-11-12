const express = require('express');
const router = express.Router();
const axios = require('axios');

// 🔐 Ambil credentials dari environment
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID?.trim();
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY?.trim();

/**
 * 📤 POST /api/notification/send
 * Mengirim notifikasi ke semua pengguna (segment 'All') dengan suara custom
 */
router.post('/send', async (req, res) => {
    try {
        const { title, message } = req.body;
        const notifTitle = title || "Notifikasi Baru";
        const notifMessage = message || "Terdapat pembaruan baru di sistem!";

        console.log("📦 Mengirim notifikasi ke OneSignal...");
        console.log("Title:", notifTitle);
        console.log("Message:", notifMessage);

        const payload = {
            app_id: ONESIGNAL_APP_ID,
            headings: { en: notifTitle },
            contents: { en: notifMessage },
            included_segments: ["All"],    // Kirim ke semua user
            android_visibility: 1,
            android_sound: "cashier",      // nama file mp3 di res/raw (tanpa .mp3)
            priority: 10                   // notifikasi langsung muncul
        };

        const response = await axios.post(
            "https://onesignal.com/api/v1/notifications",
            payload,
            {
                headers: {
                    "Authorization": `Basic ${ONESIGNAL_API_KEY}`,
                    "Content-Type": "application/json",
                },
            }
        );

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
