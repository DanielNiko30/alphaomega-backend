const express = require('express');
const router = express.Router();
const axios = require('axios');

// Simpan di .env biar aman, jangan langsung di code
const ONESIGNAL_APP_ID = "257845e8-86e4-466e-b8cb-df95a1005a5f";
const ONESIGNAL_API_KEY = "os_v2_app_ev4el2eg4rdg5ogl36k2cac2l77dtzxyewue2anofcau7i6isuunhmxqf2gty4ootqcrprhfqfgrmk3onnr6mjzf273ll2oz3rgtwiy";

// POST /api/notification/send
router.post('/send', async (req, res) => {
    try {
        const { title, message } = req.body;

        const response = await axios.post('https://onesignal.com/api/v1/notifications', {
            app_id: ONESIGNAL_APP_ID,
            headings: { en: title },
            contents: { en: message },
            included_segments: ['All'], // Kirim ke semua user
        }, {
            headers: {
                'Authorization': `Basic ${ONESIGNAL_API_KEY}`,
                'Content-Type': 'application/json',
            },
        });

        res.json({ success: true, data: response.data });
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