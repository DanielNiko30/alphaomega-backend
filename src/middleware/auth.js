const jwt = require('jsonwebtoken');
const { User } = require('../model/user_model');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Token tidak ditemukan' });

    const token = authHeader.split(' ')[1]; // Bearer TOKEN
    if (!token) return res.status(401).json({ message: 'Token tidak valid' });

    const decoded = jwt.verify(token, 'secret_key');
    req.user = decoded; // { id_user, username, role }

    next();
  } catch (err) {
    res.status(401).json({ message: 'Unauthorized', error: err.message });
  }
};

module.exports = authMiddleware;
