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
            const users = await User.findAll();
            res.json(users);
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
};

module.exports = UserController;
