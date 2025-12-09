const { DataTypes } = require('sequelize');
const { getDB } = require('../config/sequelize');

const db = getDB();

const Kategori = db.define(
    "Kategori",
    {
        id_kategori: {
            type: DataTypes.STRING(10),
            primaryKey: true,
        },
        nama_kategori: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        aktif: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },

    },
    {
        tableName: "kategori",
        timestamps: false,
    }
);

module.exports = { Kategori };