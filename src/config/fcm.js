const admin = require("firebase-admin");
const path = require("path");

// Path absolut ke serviceAccountKey.json
const serviceAccountPath = path.join(__dirname, "serviceAccountKey.json");

admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath)),
});

module.exports = admin;
