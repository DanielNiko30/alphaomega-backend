const { DataTypes } = require('sequelize');
const { getDB } = require('../config/sequelize');

const sequelize = getDB();

const Lazada = sequelize.define('Lazada', {
    account: {
        type: DataTypes.STRING(255),
        allowNull: false,
        primaryKey: true
    },
    access_token: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    refresh_token: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    expires_in: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    last_updated: {
        type: DataTypes.INTEGER, // Unix timestamp
        allowNull: false
    }
}, {
    tableName: 'lazada_routes',
    timestamps: false
});

module.exports = { Lazada };
