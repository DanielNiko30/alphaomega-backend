const admin = require("firebase-admin");
const path = require("path");

const serviceAccountPath = path.resolve(__dirname, "serviceAccountKey.json");

admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath)),
});

module.exports = admin;
