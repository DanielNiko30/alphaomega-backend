const admin = require("firebase-admin");
const path = require("path");

const serviceAccountPath = path.resolve(__dirname, "serviceAccountKey.json");
console.log("🔥 Full path ke serviceAccountKey.json:", serviceAccountPath);

const fs = require("fs");
if (!fs.existsSync(serviceAccountPath)) {
    console.error("❌ File tidak ditemukan di path ini!");
}

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
