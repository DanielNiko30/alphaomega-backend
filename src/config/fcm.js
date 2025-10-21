const admin = require("firebase-admin");
const path = require("path");

const serviceAccountPath = path.join(__dirname, "serviceAccountKey.json");

admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath)),
});

module.exports = admin;
