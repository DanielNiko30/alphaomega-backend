const { User, Kategori, Product, Stok } = require('../model/models');

async function generateUserId() {
    const lastUser = await User.findOne({ order: [['id_user', 'DESC']] });
    let newId = 'USR001';
    if (lastUser) {
        const lastIdNum = parseInt(lastUser.id_user.replace('USR', ''), 10);
        newId = `USR${String(lastIdNum + 1).padStart(3, '0')}`;
    }
    return newId;
}

const UserController = {
    getUsers: async (req, res) => {
        try {
            // Ambil semua user kecuali yang role = 'admin'
            const users = await User.findAll({
                where: {
                    role: {
                        [User.sequelize.Op.ne]: 'admin' // NE = not equal
                    }
                }
            });

            res.setHeader("Content-Type", "application/json");
            res.status(200).json(users);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    getUserById: async (req, res) => {
        try {
            const { id } = req.params;
            const user = await User.findByPk(id);
            if (!user) return res.status(404).json({ message: 'User not found' });
            res.json(user);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    createUser: async (req, res) => {
        try {
            const newId = await generateUserId();
            const newUser = await User.create({ ...req.body, id_user: newId });
            res.status(201).json(newUser);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    updateUser: async (req, res) => {
        try {
            const { id } = req.params;
            const user = await User.findByPk(id);
            if (!user) return res.status(404).json({ message: 'User not found' });

            await user.update(req.body);
            res.json({ message: 'User updated successfully' });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    deleteUser: async (req, res) => {
        try {
            const { id } = req.params;
            const user = await User.findByPk(id);
            if (!user) return res.status(404).json({ message: 'User not found' });

            await user.destroy();
            res.json({ message: 'User deleted successfully' });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    updateUserRole: async (req, res) => {
        try {
            const { id } = req.params;
            const { role } = req.body;

            console.log("🔍 ID yang diterima:", id); // cek isi id

            const user = await User.findByPk(id);
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            user.role = role;
            await user.save();
            res.json({ message: "User role updated successfully", role: user.role });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    getUsersPenjual: async (req, res) => {
        try {
            const users = await User.findAll({ where: { role: "penjual" } });
            res.json(users);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    getUsersGudang: async (req, res) => {
        try {
            const users = await User.findAll({ where: { role: "pegawai gudang" } });
            res.json(users);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

};

module.exports = UserController;
