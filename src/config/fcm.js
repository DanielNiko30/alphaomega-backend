const admin = require("firebase-admin");

// 🔥 Ganti path di bawah sesuai lokasi file kamu di server IDCloudHost
const serviceAccount = require("/home/alphaomega2/alphaomega-backend/src/config/serviceAccountKey.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
 