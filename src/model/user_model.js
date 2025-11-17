const { DataTypes } = require('sequelize');
const { getDB } = require('../config/sequelize');

const db = getDB();

const User = db.define('User', {
    id_user: {
        type: DataTypes.STRING(8),
        primaryKey: true,
    },
    username: {
        type: DataTypes.STRING(50),
        allowNull: false,
    },
    password: {
        type: DataTypes.STRING(50),
        allowNull: false,
    },
    name: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    role: {
        type: DataTypes.STRING(20),
        allowNull: false,
    },
    no_telp: {
        type: DataTypes.STRING(50),
        allowNull: false,
    },
    jenis_kelamin: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: "tidak diketahui",
    },
    alamat: {
        type: DataTypes.STRING(255),
        allowNull: false,
        defaultValue: "tidak diketahui",
    },

}, {
    tableName: 'user',
    timestamps: false,
});

module.exports = { User };
