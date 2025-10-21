const admin = require("firebase-admin");

const serviceAccountPath = "/home/alphaomega2/alphaomega-backend/src/config/serviceAccountKey.json";

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
