const { DataTypes } = require('sequelize');
const { getDB } = require("../config/sequelize");

const db = getDB();
const Stok = db.define(
    "Stok",
    {
        id_stok: {
            type: DataTypes.STRING(10),
            primaryKey: true,
        },
        id_product_stok: {
            type: DataTypes.STRING(10),
            allowNull: false,
        },
        satuan: {
            type: DataTypes.STRING(50),
            allowNull: false,
        },
        stok: {
            type: DataTypes.BIGINT(20),
            allowNull: false,
        },
        harga: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
    },
    {
        tableName: "stok",
        timestamps: false,
    }
);

module.exports = { Stok };