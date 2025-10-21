import admin from "firebase-admin";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pastikan path serviceAccountKey.json sesuai
const serviceAccountPath = path.join(__dirname, "serviceAccountKey.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
});

export default admin;
