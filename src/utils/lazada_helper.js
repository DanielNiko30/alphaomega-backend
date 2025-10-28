const axios = require("axios");
const { Lazada } = require("../model/lazada_model");

/**
 * Cek apakah access_token Lazada sudah expired
 * @param {Lazada} lazadaData
 * @returns {boolean}
 */
function isLazadaTokenExpired(lazadaData) {
    const now = Math.floor(Date.now() / 1000);
    const expireAt = lazadaData.last_updated + lazadaData.expires_in;

    console.log(`[LAZADA DEBUG] now: ${now} | expireAt: ${expireAt} | expires_in: ${lazadaData.expires_in}`);
    return now >= expireAt;
}

module.exports = {
    isLazadaTokenExpired,
};
