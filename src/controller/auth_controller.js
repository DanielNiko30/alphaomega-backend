const jwt = require('jsonwebtoken');
const { User } = require('../model/user_model');

exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;

        // 🔹 cari user di DB
        const user = await User.findOne({ where: { username } });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // 🔹 cek password
        if (password !== user.password) {
            return res.status(401).json({ message: 'Invalid password' });
        }

        // 🔹 generate JWT
        const token = jwt.sign(
            { id_user: user.id_user, username: user.username, role: user.role },
            'secret_key',
            { expiresIn: '1h' }
        );

        // 🔹 kirim token + data user
        res.json({
            token,
            user: {
                id_user: user.id_user,
                username: user.username,
                name: user.name,
                role: user.role,
                no_telp: user.no_telp,
            },
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};


