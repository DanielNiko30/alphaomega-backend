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

        // Payload lengkap untuk Android + iOS
        const payload = {
            app_id: ONESIGNAL_APP_ID,
            headings: { en: notifTitle },
            contents: { en: notifMessage },
            included_segments: ["All"],

            // ✅ Pastikan ini aktif
            android_sound: "cashier",     // cashier.mp3 di android/app/src/main/res/raw/
            small_icon: "ic_stat_onesignal_default", // optional icon default
            large_icon: "ic_launcher",    // optional
            priority: 10,
            android_visibility: 1,

            // ❗ jangan pakai listener foreground untuk app terminated
            // jadi backend kirim murni payload yang bisa langsung di-handle oleh OneSignal SDK
            data: {
                route: "/detailPesanan",
                idPesanan: "12345",
            },
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
