const { DataTypes } = require('sequelize');
const { getDB } = require("../config/sequelize");

const db = getDB();
const Supplier = db.define(
    "Supplier",
    {
        id_supplier: {
            type: DataTypes.STRING(10),
            primaryKey: true,
            allowNull: false,
        },
        nama_supplier: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        no_telp: {
            type: DataTypes.STRING(50),
            allowNull: false,
        },
        keterangan: {
            type: DataTypes.TEXT,
            allowNull: true, // bisa null
        },
        aktif: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },

    },

    {
        tableName: 'supplier',
        timestamps: false,
    }
);

module.exports = { Supplier };
