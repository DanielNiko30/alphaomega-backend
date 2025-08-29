const fetch = require('node-fetch'); // pastikan sudah install node-fetch
const { ShopeeToken } = require('../../models'); // Model Sequelize untuk menyimpan token

const YOUR_PARTNER_ID = process.env.SHOPEE_PARTNER_ID;
const YOUR_PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;

const shopeeCallback = async (req, res) => {
    const { code, shop_id, state } = req.query;

    if (!code || !shop_id) {
        return res.status(400).json({ error: 'Missing code or shop_id' });
    }

    try {
        // 🔹 Tukarkan code dengan access token
        const response = await fetch('https://partner.shopeemobile.com/api/v2/auth/token/get', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                partner_id: YOUR_PARTNER_ID,
                partner_key: YOUR_PARTNER_KEY,
                code,
                shop_id,
            }),
        });

        const data = await response.json();
        console.log('Shopee token response:', data);

        // 🔹 Cek error dari Shopee
        if (data.error !== 0) {
            return res.status(400).json({ error: data.message });
        }

        // 🔹 Simpan token ke database
        // Model ShopeeToken { shop_id, access_token, refresh_token, expired_at }
        await ShopeeToken.upsert({
            shop_id,
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expired_at: new Date(Date.now() + data.expires_in * 1000),
        });

        res.json({ success: true, message: 'Token berhasil diterima' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error saat tukar code ke token' });
    }
};

module.exports = { shopeeCallback };
