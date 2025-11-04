const { DataTypes } = require("sequelize");
const { getDB } = require("../config/sequelize");
const { Product } = require("./product_model");

const db = getDB();

const DTransBeli = db.define(
  "DTransBeli",
  {
    id_dtrans_beli: {
      type: DataTypes.STRING(20),
      primaryKey: true,
    },
    id_htrans_beli: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    id_produk: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    jumlah_barang: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    harga_satuan: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    diskon_barang: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    subtotal: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: "dtrans_pembelian",
    timestamps: false,
  }
);

// ✅ Relasi ke produk
DTransBeli.belongsTo(Product, {
  foreignKey: "id_produk",
  as: "produk",
});

// ✅ Relasi balik dari produk ke detail pembelian
Product.hasMany(DTransBeli, {
  foreignKey: "id_produk", // ⬅️ ini diperbaiki dari id_product
  as: "detail_pembelian",
});

module.exports = { DTransBeli };
