const admin = require("firebase-admin");
const path = require("path");

const serviceAccountPath = path.join(__dirname, "./src/config/serviceAccountKey.json");

admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath)),
});

module.exports = admin;
