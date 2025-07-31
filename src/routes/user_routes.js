const express = require('express');
const { getUsers, getUserById, createUser, updateUser, deleteUser } = require('../controller/user_controller');

const router = express.Router();

router.get('/', getUsers);
router.get('/:id', getUserById);
router.post('/', createUser);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

module.exports = router;


