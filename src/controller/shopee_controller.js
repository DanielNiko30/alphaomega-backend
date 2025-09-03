const crypto = require("crypto");
const https = require("https");

const PARTNER_ID = Number(process.env.SHOPEE_PARTNER_ID);
let PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY?.trim();

/**
 * POST JSON Helper
 */
function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsedUrl = new URL(url);

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let chunks = "";
      res.on("data", (chunk) => (chunks += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(chunks));
        } catch (err) {
          reject(new Error(`Invalid JSON response: ${chunks}`));
        }
      });
    });

    req.on("error", (err) => reject(err));
    req.write(data);
    req.end();
  });
}

const shopeeCallback = async (req, res) => {
  try {
    const { code, shop_id, state } = req.query;

    console.log("===== CALLBACK QUERY =====", { code, shop_id, state });

    if (!code || !shop_id) {
      return res.status(400).json({ error: "Missing code or shop_id" });
    }

    const shopIdStr = String(shop_id); // wajib string
    const timestamp = Math.floor(Date.now() / 1000);
    const path = "/api/v2/auth/token/get";

    // Signature
    const baseString = `${PARTNER_ID}${path}${timestamp}${shopIdStr}`;
    const sign = crypto.createHmac("sha256", PARTNER_KEY).update(baseString).digest("hex");

    console.log("===== SIGN DEBUG =====");
    console.log({ baseString, sign, PARTNER_ID, timestamp, shopIdStr, key_length: PARTNER_KEY.length });

    const url = `https://partner.shopeemobile.com${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;

    const body = { code, shop_id: shopIdStr, partner_id: PARTNER_ID };

    console.log("POST URL:", url);
    console.log("POST BODY:", body);

    const shopeeResponse = await postJSON(url, body);

    console.log("===== SHOPEE RESPONSE =====");
    console.log(shopeeResponse);

    return res.json({
      success: true,
      shop_id: shopIdStr,
      data: {
        partner_id: PARTNER_ID,
        timestamp,
        baseString,
        generatedSign: sign,
        url,
        shopee_response: shopeeResponse,
      },
    });
  } catch (err) {
    console.error("Shopee Callback Error:", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
};

module.exports = { shopeeCallback };
