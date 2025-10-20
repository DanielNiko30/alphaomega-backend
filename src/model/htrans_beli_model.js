const { DataTypes } = require("sequelize");
const { getDB } = require("../config/sequelize");
const { DTransBeli } = require("./dtrans_beli_model");
const { Supplier } = require("./supplier_model"); // opsional kalau ada tabel supplier

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
      type: DataTypes.DATEONLY, // pakai DATEONLY biar bisa difilter lebih mudah
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
      defaultValue: 0,
    },
  },
  {
    tableName: "htrans_pembelian",
    timestamps: false,
  }
);

// ✅ Relasi ke detail transaksi
HTransBeli.hasMany(DTransBeli, {
  foreignKey: "id_htrans_beli",
  as: "detail_transaksi",
});

// ✅ Relasi balik dari DTransBeli ke HTransBeli
DTransBeli.belongsTo(HTransBeli, {
  foreignKey: "id_htrans_beli",
  as: "HTransBeli",
});

// ✅ Relasi ke Supplier (kalau tabelnya ada)
if (Supplier) {
  HTransBeli.belongsTo(Supplier, {
    foreignKey: "id_supplier",
    as: "supplier",
  });
}

module.exports = { HTransBeli };
