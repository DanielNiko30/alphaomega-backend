
const jwt = require('jsonwebtoken');
const { User } = require('../model/user_model');

exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ where: { username } });
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (password !== user.password) return res.status(401).json({ message: 'Invalid password' });

        const token = jwt.sign({ id: user.id_user, username: user.username }, 'secret_key', { expiresIn: '1h' });
        res.json({ token });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

