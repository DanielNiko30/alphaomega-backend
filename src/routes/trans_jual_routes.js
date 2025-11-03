const express = require("express");
const TransJualController = require("../controller/trans_jual_controller");

const router = express.Router();

router.get("/invoice/latest", TransJualController.getLatestInvoiceNumber);
router.get("/", TransJualController.getAllTransactions);
router.get("/:id", TransJualController.getTransactionById);
router.post("/", TransJualController.createTransaction);
router.get("/status/pending", TransJualController.getPendingTransactions);
router.get("/status/lunas", TransJualController.getLunasTransactions);
router.get("/detail/byhtrans/:id_htrans", TransJualController.getDetailTransactionByHeaderId);
router.put("/transjual/:id_htrans_jual", TransJualController.updateTransaction);
router.put("/update-status/:id_htrans_jual", TransJualController.updateStatusTransaction);
router.post("/status/pending/penjual", TransJualController.getPendingTransactionsByPenjual);

module.exports = router;
