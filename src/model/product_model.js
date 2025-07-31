const { DataTypes } = require("sequelize");
const { getDB } = require("../config/sequelize");
const { Stok } = require("./stok_model");
const { Kategori } = require("./kategori_model");

const db = getDB();

const Product = db.define(
  "Product",
  {
    id_product: {
      type: DataTypes.STRING(10),
      primaryKey: true,
    },
    product_kategori: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    nama_product: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    gambar_product: {
      type: DataTypes.BLOB("long"),
      allowNull: true,
    },
    deskripsi_product: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
  },
  {
    tableName: "product",
    timestamps: false,
  }
);

module.exports = { Product };
