const express = require("express");
const TransBeliController = require("../controller/trans_beli_controller");

const router = express.Router();

router.get("/", TransBeliController.getAllTransactions);
router.get("/:id", TransBeliController.getTransactionById);
router.post("/", TransBeliController.createTransaction);
router.put("/:id_htrans_beli", TransBeliController.updateTransaction);

module.exports = router;
