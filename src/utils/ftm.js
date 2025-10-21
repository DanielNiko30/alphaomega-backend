import admin from "firebase-admin";
import fs from "fs";
import path from "path";

const serviceAccountPath = path.resolve("config/serviceAccountKey.json");

// pastikan file key ada
if (!fs.existsSync(serviceAccountPath)) {
  console.error("❌ serviceAccountKey.json tidak ditemukan di /config");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccountPath),
});

export const sendNotification = async (token, title, body, data = {}) => {
  if (!token) return;

  const message = {
    token,
    notification: { title, body },
    data, // data tambahan (optional)
  };

  try {
    await admin.messaging().send(message);
    console.log(`✅ Notifikasi terkirim ke token: ${token}`);
  } catch (err) {
    console.error("❌ Gagal kirim notifikasi:", err);
  }
};
