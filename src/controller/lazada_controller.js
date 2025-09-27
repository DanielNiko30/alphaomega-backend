const axios = require('axios');
const crypto = require('crypto');
const { Lazada } = require('../model/lazada_model');

/**
 * Helper: Generate Lazada Signature
 * Lazada base string: /path + sortedKeyValue
 */
function generateSign(path, params, appSecret) {
    const sortedKeys = Object.keys(params).sort();
    let baseString = path;

    for (const key of sortedKeys) {
        baseString += key + params[key];
    }

    return crypto.createHmac('sha256', appSecret).update(baseString).digest('hex').toUpperCase();
}

/**
 * Generate Login URL Lazada
 */
const generateLoginUrl = (req, res) => {
    try {
        const CLIENT_ID = process.env.LAZADA_APP_KEY;
        const REDIRECT_URI = encodeURIComponent('https://tokalphaomegaploso.my.id/api/lazada/callback');

        const state = Math.random().toString(36).substring(2, 15); // random string

        const loginUrl = `https://auth.lazada.com/oauth/authorize?response_type=code&force_auth=true&redirect_uri=${REDIRECT_URI}&client_id=${CLIENT_ID}&state=${state}`;

        return res.json({ login_url: loginUrl });
    } catch (err) {
        console.error("Generate Login URL Error:", err.message);
        return res.status(500).json({ error: 'Gagal generate login URL' });
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
            return res.status(400).json({ error: "Missing code from Lazada callback" });
        }

        const CLIENT_ID = process.env.LAZADA_APP_KEY;
        const CLIENT_SECRET = process.env.LAZADA_APP_SECRET;
        const API_PATH = "/auth/token/create";
        const TIMESTAMP = Date.now(); // Lazada pakai milidetik

        // === 1. Parameter wajib ===
        const params = {
            app_key: CLIENT_ID,
            code: code,
            sign_method: "sha256",
            timestamp: TIMESTAMP,
        };

        // === 2. Generate signature ===
        const sign = generateSign(API_PATH, params, CLIENT_SECRET);
        params.sign = sign;

        // === 3. Kirim request ===
        const url = `https://api.lazada.com/rest${API_PATH}`;
        const response = await axios.post(url, new URLSearchParams(params), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        console.log("RAW RESPONSE FROM LAZADA:", response.data);

        const tokenData = response.data;

        if (!tokenData.access_token) {
            return res.status(400).json({ error: "Invalid token response from Lazada", data: tokenData });
        }

        // === 4. Simpan ke DB ===
        await Lazada.destroy({ where: {} }); // hapus token lama
        await Lazada.create({
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            account: tokenData.account,
            expires_in: tokenData.expires_in,
            last_updated: Math.floor(Date.now() / 1000)
        });

        return res.json({
            success: true,
            state,
            tokenData
        });
    } catch (err) {
        console.error("Lazada Callback Error:", err.response?.data || err.message);
        return res.status(500).json({ error: err.response?.data || err.message });
    }
};

/**
 * Refresh Access Token Lazada
 */
const refreshToken = async (req, res) => {
    try {
        const CLIENT_ID = process.env.LAZADA_APP_KEY;
        const CLIENT_SECRET = process.env.LAZADA_APP_SECRET;
        const API_PATH = "/auth/token/refresh";
        const TIMESTAMP = Date.now();

        const lazadaData = await Lazada.findOne();
        if (!lazadaData) {
            return res.status(404).json({ error: "Lazada token not found in database" });
        }

        // === 1. Parameter wajib ===
        const params = {
            app_key: CLIENT_ID,
            refresh_token: lazadaData.refresh_token,
            sign_method: "sha256",
            timestamp: TIMESTAMP
        };

        // === 2. Generate signature ===
        const sign = generateSign(API_PATH, params, CLIENT_SECRET);
        params.sign = sign;

        // === 3. Request ke Lazada ===
        const url = `https://api.lazada.com/rest${API_PATH}`;
        const response = await axios.post(url, new URLSearchParams(params), {
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
            return res.status(500).json({ error: "Failed to refresh token", data: tokenData });
        }

        return res.json({
            success: true,
            tokenData
        });
    } catch (err) {
        console.error("Lazada Refresh Token Error:", err.response?.data || err.message);
        return res.status(500).json({ error: err.response?.data || err.message });
    }
};

module.exports = {
    generateLoginUrl,
    lazadaCallback,
    refreshToken
};
