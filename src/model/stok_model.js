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
        id_product_shopee: {
            type: DataTypes.BIGINT,
            allowNull: true
        },
        id_product_lazada: {
            type: DataTypes.BIGINT,
            allowNull: true
        },
        sku_lazada: {
            type: DataTypes.STRING,
            allowNull: true,
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
        harga_beli: {
            type: DataTypes.INTEGER,
            allowNull: false,   // ❌ tidak boleh null
            defaultValue: 0,    // 🟢 default 0
        },
        aktif: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
    },
    {
        tableName: "stok",
        timestamps: false,
    }
);

module.exports = { Stok };