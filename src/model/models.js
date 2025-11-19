const { DataTypes } = require('sequelize');
const { getDB } = require('../config/sequelize');

const db = getDB();

// User
const User = db.define('user', {
    id_user: { type: DataTypes.STRING(8), primaryKey: true },
    username: { type: DataTypes.STRING(50), allowNull: false },
    password: { type: DataTypes.STRING(50), allowNull: false },
    name: { type: DataTypes.STRING(255), allowNull: false },
    role: { type: DataTypes.STRING(20), allowNull: false },
    no_telp: { type: DataTypes.STRING(50), allowNull: false },
    jenis_kelamin: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: "tidak diketahui",
    },
    alamat: {
        type: DataTypes.STRING(255),
        allowNull: false,
        defaultValue: "tidak diketahui",
    },
    aktif: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
    },
}, { tableName: 'user', timestamps: false });

// Kategori
const Kategori = db.define('kategori', {
    id_kategori: { type: DataTypes.STRING(10), primaryKey: true },
    nama_kategori: { type: DataTypes.STRING(255), allowNull: false },
}, { tableName: 'kategori', timestamps: false });

// Product
const Product = db.define('product', {
    id_product: { type: DataTypes.STRING(10), primaryKey: true },
    product_kategori: { type: DataTypes.STRING(10), allowNull: false },
    nama_product: { type: DataTypes.STRING(255), allowNull: false },
    deskripsi_product: { type: DataTypes.STRING(255), allowNull: false },
    gambar_product: { type: DataTypes.BLOB('long'), allowNull: true },
}, { tableName: 'product', timestamps: false });

// Stok
const Stok = db.define('stok', {
    id_stok: { type: DataTypes.STRING(10), primaryKey: true },
    id_product_stok: { type: DataTypes.STRING(10), allowNull: false },
    satuan: { type: DataTypes.STRING(50), allowNull: false },
    stok: { type: DataTypes.INTEGER, allowNull: false },
    harga: { type: DataTypes.INTEGER, allowNull: false },
}, { tableName: 'stok', timestamps: false });

// Relasi
Product.hasMany(Stok, { as: 'stok', foreignKey: 'id_product_stok' });
Stok.belongsTo(Product, { foreignKey: 'id_product_stok' });

module.exports = { db, User, Kategori, Product, Stok };
