const { DataTypes } = require("sequelize");
const { getDB } = require("../config/sequelize");
const { Stok } = require("./stok_model");
const { Kategori } = require("./kategori_model");
const { DTransBeli } = require("./dtrans_beli_model");

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
    aktif: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },

  },
  {
    tableName: "product",
    timestamps: false,
  }
);

Product.hasMany(Stok, { as: 'stok', foreignKey: 'id_product_stok' });
Stok.belongsTo(Product, { foreignKey: 'id_product_stok' });

Product.belongsTo(Kategori, { foreignKey: 'product_kategori', as: 'kategori' });
Kategori.hasMany(Product, { foreignKey: 'product_kategori', as: 'products' });
Product.hasMany(DTransBeli, {
  as: "detail_pembelian",
  foreignKey: "id_product",
});
module.exports = { Product };
