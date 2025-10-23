const express = require('express');
const router = express.Router();
const axios = require('axios');

// OneSignal App credentials (sebaiknya pindahkan ke .env nanti)
const ONESIGNAL_APP_ID = "257845e8-86e4-466e-b8cb-df95a1005a5f";
const ONESIGNAL_API_KEY = "os_v2_app_ev4el2eg4rdg5ogl36k2cac2l77dtzxyewue2anofcau7i6isuunhmxqf2gty4ootqcrprhfqfgrmk3onnr6mjzf273ll2oz3rgtwiy";

// ✅ Endpoint kirim notifikasi
router.post('/send', async (req, res) => {
    try {
        // Ambil title & message dari request body, kalau kosong isi default
        const { title, message } = req.body;
        const notifTitle = title || 'Notifikasi Baru';
        const notifMessage = message || 'Terdapat pesanan baru di sistem!';

        // Kirim ke OneSignal API
        const response = await axios.post('https://onesignal.com/api/v1/notifications', {
            app_id: ONESIGNAL_APP_ID,
            headings: { en: title },
            contents: { en: message },
            included_segments: ['All'],
            android_visibility: 1, // pastikan visible
            android_sound: "default",
            priority: 10,
        });

        // Kalau sukses
        res.json({
            success: true,
            message: '✅ Notifikasi berhasil dikirim!',
            data: response.data,
        });
    } catch (err) {
        console.error('❌ OneSignal Error:');
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Data:', err.response.data);
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