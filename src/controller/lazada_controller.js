const axios = require('axios');
const { Lazada } = require('../model/lazada_model');

/**
 * Generate Login URL Lazada
 */
const generateLoginUrl = (req, res) => {
    try {
        const CLIENT_ID = process.env.LAZADA_APP_KEY;
        const REDIRECT_URI = encodeURIComponent('https://tokalphaomegaploso.my.id/api/lazada/callback');
        const state = 'xyz'; // opsional, untuk verifikasi

        const loginUrl = `https://auth.lazada.com/oauth/authorize?response_type=code&force_auth=true&redirect_uri=${REDIRECT_URI}&client_id=${CLIENT_ID}&state=${state}`;

        res.json({ login_url: loginUrl });
    } catch (err) {
        console.error("Generate Login URL Error:", err);
        res.status(500).json({ error: 'Gagal generate login URL' });
    }
};

/**
 * Callback setelah login Lazada
 * Menukar code dengan access_token & refresh_token, lalu simpan ke database
 */
const lazadaCallback = async (req, res) => {
    try {
        const { code, state } = req.query;

        if (!code) {
            return res.status(400).json({ error: "Missing code" });
        }

        const CLIENT_ID = process.env.LAZADA_APP_KEY;
        const CLIENT_SECRET = process.env.LAZADA_APP_SECRET;

        const url = 'https://auth.lazada.com/rest/auth/token/create';

        const body = new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code: code
        });

        const response = await axios.post(url, body, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const tokenData = response.data;

        if (tokenData.access_token && tokenData.refresh_token) {
            // Simpan ke database (hapus data lama dulu, karena hanya satu akun)
            await Lazada.destroy({ where: {} });

            await Lazada.create({
                account: tokenData.account || 'default',
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_in: tokenData.expires_in,
                last_updated: Math.floor(Date.now() / 1000)
            });

            console.log(`✅ Lazada token saved for account: ${tokenData.account}`);
        } else {
            console.error("❌ Lazada did not return token:", tokenData);
            return res.status(500).json({ error: "Invalid token response from Lazada" });
        }

        res.json({
            success: true,
            state,
            tokenData
        });
    } catch (err) {
        console.error("Lazada Callback Error:", err.response?.data || err.message);
        res.status(500).json({ error: err.response?.data || err.message });
    }
};

/**
 * Refresh Access Token Lazada
 */
const refreshToken = async (req, res) => {
    try {
        const CLIENT_ID = process.env.LAZADA_APP_KEY;
        const CLIENT_SECRET = process.env.LAZADA_APP_SECRET;

        const lazadaData = await Lazada.findOne();
        if (!lazadaData) {
            return res.status(404).json({ error: "Lazada token not found in database" });
        }

        const url = 'https://auth.lazada.com/rest/auth/token/refresh';
        const body = new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
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

            console.log(`🔄 Lazada token refreshed for account: ${lazadaData.account}`);
        } else {
            return res.status(500).json({ error: "Failed to refresh token" });
        }

        res.json({
            success: true,
            tokenData
        });
    } catch (err) {
        console.error("Lazada Refresh Token Error:", err.response?.data || err.message);
        res.status(500).json({ error: err.response?.data || err.message });
    }
};

module.exports = {
    generateLoginUrl,
    lazadaCallback,
    refreshToken
};
