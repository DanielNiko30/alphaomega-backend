const { DataTypes } = require("sequelize");
const { getDB } = require("../config/sequelize");
const { DTransBeli } = require("./dtrans_beli_model");

const db = getDB();

const HTransBeli = db.define(
  "HTransBeli",
  {
    id_htrans_beli: {
      type: DataTypes.STRING(20),
      primaryKey: true,
    },
    id_supplier: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    tanggal: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    total_harga: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    metode_pembayaran: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    nomor_invoice: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    ppn: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: "htrans_pembelian",
    timestamps: false,
  }
);

// Relasi
HTransBeli.hasMany(DTransBeli, { foreignKey: "id_htrans_beli", as: "detail_transaksi" });

module.exports = { HTransBeli };
