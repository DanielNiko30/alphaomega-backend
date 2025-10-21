const admin = require("firebase-admin");
const path = require("path");

// Path absolut ke serviceAccountKey.json
const serviceAccountPath = path.resolve(
  __dirname,
  "serviceAccountKey.json"
);

// Load file JSON
const serviceAccount = require(serviceAccountPath);

// Inisialisasi Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;