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
        const { title, message, idPesanan, namaPembeli } = req.body;
        const notifTitle = title || "Notifikasi Baru";
        const notifMessage = message || "Ada pembaruan baru di sistem!";

        console.log("📦 Mengirim notifikasi ke OneSignal...");
        console.log("Title:", notifTitle);
        console.log("Message:", notifMessage);

        // ✅ Payload lengkap untuk Android agar bunyi + tampil di system tray walau app tertutup
        const payload = {
            app_id: ONESIGNAL_APP_ID,
            headings: { en: notifTitle },
            contents: { en: notifMessage },
            included_segments: ["All"],

            // ✅ Channel dan suara
            android_channel_id: "a113ecdb-c25e-4c3d-9461-3d0a9161ad46", // harus sama dengan di AndroidManifest
            android_sound: "cashier",      // nama file di res/raw tanpa .mp3
            android_priority: 10,
            android_visibility: 1,

            // ✅ Opsional: ikon notif
            small_icon: "ic_stat_onesignal_default",
            large_icon: "ic_launcher",

            // ✅ Data tambahan untuk klik handler di Flutter
            data: {
                route: "/detailPesanan",
                idPesanan: idPesanan || "12345",
                namaPembeli: namaPembeli || "John Doe",
            },

            ttl: 3600, // time-to-live (1 jam)
        };

        const response = await axios.post(
            "https://onesignal.com/api/v1/notifications",
            payload,
            {
                headers: {
                    Authorization: `Basic ${ONESIGNAL_API_KEY}`,
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
