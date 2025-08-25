const express = require('express');
const { getUsers, getUserById, createUser, updateUser, deleteUser, updateUserRole, getUsersGudang, getUsersPenjual } = require('../controller/user_controller');

const router = express.Router();

router.get('/', getUsers);
router.get('/:id', getUserById);
router.post('/', createUser);
router.put('/:id', updateUser);
router.get("/role/penjual", getUsersPenjual);
router.get("/role/gudang", getUsersGudang);
router.put("/:id/role", updateUserRole);
router.delete('/:id', deleteUser);

module.exports = router;


