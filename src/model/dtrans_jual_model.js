const { DataTypes } = require("sequelize");
const { getDB } = require("../config/sequelize");

const db = getDB();

const DTransJual = db.define(
  "DTransJual",
  {
    id_dtrans_jual: {
      type: DataTypes.STRING(20),
      primaryKey: true,
    },
    id_htrans_jual: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    id_produk: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    satuan: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    jumlah_barang: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    harga_satuan: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    subtotal: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: "dtrans_penjualan",
    timestamps: false,
  }
);

module.exports = { DTransJual };
