const { DataTypes } = require("sequelize");
const { getDB } = require("../config/sequelize");
const { DTransJual } = require("./dtrans_jual_model");
const { User } = require("./user_model"); // ⬅️ Tambahkan ini

const db = getDB();

const HTransJual = db.define(
  "HTransJual",
  {
    id_htrans_jual: {
      type: DataTypes.STRING(20),
      primaryKey: true,
    },
    id_user: {
      type: DataTypes.STRING(8),
      allowNull: false,
    },
    id_user_penjual: {
      type: DataTypes.STRING(8),
      allowNull: false,
    },
    nama_pembeli: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    tanggal: {
      type: DataTypes.DATEONLY,
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
      allowNull: true,
    },
    order_sn: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    package_number: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
    sumber_transaksi: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
  },
  {
    tableName: "htrans_penjualan",
    timestamps: false,
  },
);

// Relasi ke DTransJual
HTransJual.hasMany(DTransJual, {
  foreignKey: "id_htrans_jual",
  as: "detail_transaksi",
});
DTransJual.belongsTo(HTransJual, {
  foreignKey: "id_htrans_jual",
});

// Relasi ke User
HTransJual.belongsTo(User, {
  foreignKey: "id_user",
  as: "user",
});

HTransJual.belongsTo(User, {
  foreignKey: "id_user_penjual",
  as: "penjual",
});

module.exports = { HTransJual };
