const { DataTypes } = require("sequelize");
const { getDB } = require("../config/sequelize");

const db = getDB();

const Shopee = db.define("shopee", {
  shop_id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    allowNull: false,
  },
  access_token: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  refresh_token: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  expire_in: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  last_updated: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
}, {
  tableName: "shopee",
  timestamps: false, // tidak membuat createdAt & updatedAt
});

module.exports = { Shopee };
