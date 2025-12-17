const jwt = require('jsonwebtoken');
const { User } = require('../model/user_model');

/**
 * Middleware untuk autentikasi JWT
 * - Memastikan ada token di header Authorization
 * - Menyimpan data user di req.user
 * - Mendukung admin melakukan action tapi tetap pakai id pegawai online
 */
const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader)
            return res.status(401).json({ message: 'Token tidak ditemukan' });

        const token = authHeader.split(' ')[1]; // Bearer TOKEN
        if (!token)
            return res.status(401).json({ message: 'Token tidak valid' });

        // Verifikasi token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
        // decoded biasanya berisi { id_user, username, role }

        if (!decoded || !decoded.id_user || !decoded.role) {
            return res.status(401).json({ message: 'Token tidak valid' });
        }

        // Ambil user dari DB untuk memastikan masih ada
        const user = await User.findOne({ where: { id_user: decoded.id_user } });
        if (!user) {
            return res.status(401).json({ message: 'User tidak ditemukan' });
        }

        // simpan user di req.user
        req.user = {
            id_user: user.id_user,
            username: user.username,
            role: user.role,
            name: user.name || '',
            no_telp: user.no_telp || '',
        };

        // Jika admin, tambahkan flag isAdmin
        req.user.isAdmin = user.role === 'admin';

        next();
    } catch (err) {
        console.error('❌ Auth Middleware Error:', err);
        res.status(401).json({ message: 'Unauthorized', error: err.message });
    }
};

const authLazadaMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        // ❌ Header tidak ada
        if (!authHeader) {
            console.warn("⚠️ Lazada Auth: Authorization header tidak ditemukan");
            return res.status(401).json({ message: 'Token tidak ditemukan' });
        }

        // 💡 Ambil token
        let token;
        if (authHeader.startsWith("Bearer ")) {
            token = authHeader.split(' ')[1];
        } else {
            token = authHeader; // fallback kalau tanpa Bearer
        }

        if (!token) {
            console.warn("⚠️ Lazada Auth: Token kosong setelah parsing header");
            return res.status(401).json({ message: 'Token tidak valid' });
        }

        // 🔏 Verifikasi JWT
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
        if (!decoded || !decoded.id_user || !decoded.role) {
            console.warn("⚠️ Lazada Auth: Token JWT decoded tidak valid", decoded);
            return res.status(401).json({ message: 'Token tidak valid' });
        }

        // 👤 Ambil user dari DB
        const user = await User.findOne({ where: { id_user: decoded.id_user } });
        if (!user) {
            console.warn("⚠️ Lazada Auth: User tidak ditemukan di DB, id_user:", decoded.id_user);
            return res.status(401).json({ message: 'User tidak ditemukan' });
        }

        // 📝 Simpan info user di req.user
        req.user = {
            id_user: user.id_user,
            username: user.username,
            role: user.role,
            name: user.name || '',
            no_telp: user.no_telp || '',
            isAdmin: user.role === 'admin',
            isPegawaiOnline: user.role === 'pegawai online',
        };

        console.log(`✅ Lazada Auth: User authenticated - ${user.username} (${user.role})`);

        next();
    } catch (err) {
        console.error('❌ Lazada Auth Middleware Error:', err.message || err);
        return res.status(401).json({
            message: 'Unauthorized',
            error: err.message,
        });
    }
};

module.exports = { authMiddleware, authLazadaMiddleware };
