const fetch = require('node-fetch'); // pastikan sudah install node-fetch
const { ShopeeToken } = require('../../models'); // Model Sequelize untuk menyimpan token

const YOUR_PARTNER_ID = process.env.SHOPEE_PARTNER_ID;
const YOUR_PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;

const shopeeCallback = async (req, res) => {
    const { code, shop_id, state } = req.query;

    if (!code || !shop_id) {
        return res.status(400).json({ error: 'Missing code or shop_id' });
    }

    // Untuk test sementara
    return res.json({
        success: true,
        message: 'Callback Shopee diterima',
        code,
        shop_id,
        state
    });
};


module.exports = { shopeeCallback };
