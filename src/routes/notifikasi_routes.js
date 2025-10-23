const express = require('express');
const router = express.Router();
const axios = require('axios');

// Simpan di .env biar aman, jangan langsung di code
const ONESIGNAL_APP_ID = "ca62c025-c833-4485-888c-c27b87d810e3";
const ONESIGNAL_API_KEY = "os_v2_org_zjrmajoigncilcemyj5ypwaq4mkqdpyltkhudtniimr55busbnbjmmyav4ew22mhmqoudl6ybek4hliyggmlqhufrjjhmsuycsoj6ga";

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
        console.error(err.response?.data || err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;