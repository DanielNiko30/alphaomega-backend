const { Product } = require("./product_model");
const { Stok } = require("./stok_model");

function initRelation() {
  Product.hasMany(Stok, {
    foreignKey: "id_product_stok",
    as: "stok",
  });

  Stok.belongsTo(Product, {
    foreignKey: "id_product_stok",
    as: "product",
  });
}

module.exports = initRelation;
