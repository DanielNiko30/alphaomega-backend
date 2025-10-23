const express = require('express');
const router = express.Router();
const axios = require('axios');

// Simpan di .env biar aman, jangan langsung di code
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = "os_v2_app_ev4el2eg4rdg5ogl36k2cac2l5hfdmdho4cun55pz2boaaqipxm2354ctowrlu4gjudqhipmtjigu3javtddrogkgml3agb5zhye76q";

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