const axios = require("axios");
const { Shopee } = require("../models/shopee_model");

function isTokenExpired(shop) {
    const now = Math.floor(Date.now() / 1000);
    return shop.last_updated + shop.expire_in < now;
}

async function refreshShopeeToken(shop) {
    const PARTNER_ID = process.env.SHOPEE_PARTNER_ID;
    let PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;
    if (PARTNER_KEY) PARTNER_KEY = PARTNER_KEY.trim();

    const timestamp = Math.floor(Date.now() / 1000);
    const path = "/api/v2/auth/token/get";
    const url = `https://partner.shopeemobile.com${path}`;

    const baseString = `${PARTNER_ID}${path}${timestamp}${shop.refresh_token}`;
    const sign = require("crypto").createHmac("sha256", PARTNER_KEY).update(baseString).digest("hex");

    const response = await axios.post(url, {
        partner_id: PARTNER_ID,
        refresh_token: shop.refresh_token,
        timestamp,
        sign
    });

    const data = response.data;
    if (data && data.access_token) {
        await Shopee.update({
            access_token: data.access_token,
            expire_in: data.expire_in,
            last_updated: Math.floor(Date.now() / 1000),
            refresh_token: data.refresh_token
        }, { where: { shop_id: shop.shop_id } });
    }
}

module.exports = { isTokenExpired, refreshShopeeToken };
