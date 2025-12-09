const { Supplier } = require("../model/supplier_model");

async function generateSupplierId() {
    const lastSupplier = await Supplier.findOne({ order: [['id_supplier', 'DESC']] });
    let newId = 'SUP001';
    if (lastSupplier) {
        const lastIdNum = parseInt(lastSupplier.id_supplier.replace('SUP', ''), 10);
        newId = `SUP${String(lastIdNum + 1).padStart(3, '0')}`;
    }
    return newId;
}

const SupplierController = {
    getAllSuppliers: async (req, res) => {
        try {
            const suppliers = await Supplier.findAll({
                where: { aktif: true }   // ✅ hanya supplier aktif
            });

            res.json(suppliers);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    getSupplierById: async (req, res) => {
        try {
            const { id } = req.params;
            const supplier = await Supplier.findByPk(id);
            if (!supplier) return res.status(404).json({ message: 'Supplier not found' });
            res.json(supplier);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    createSupplier: async (req, res) => {
        try {
            const newId = await generateSupplierId();
            const newSupplier = await Supplier.create({ ...req.body, id_supplier: newId });
            res.status(201).json(newSupplier);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    updateSupplier: async (req, res) => {
        try {
            const { id } = req.params;
            const supplier = await Supplier.findByPk(id);
            if (!supplier) return res.status(404).json({ message: 'Supplier not found' });

            await supplier.update(req.body);
            res.json({ message: 'Supplier updated successfully' });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    deleteSupplier: async (req, res) => {
        try {
            const { id } = req.params;

            const supplier = await Supplier.findByPk(id);
            if (!supplier) {
                return res.status(404).json({ message: 'Supplier not found' });
            }

            // Soft delete → set aktif = false
            await supplier.update({ aktif: false });

            res.json({ message: 'Supplier deleted (soft delete) successfully' });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

};

module.exports = SupplierController;