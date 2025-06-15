const express = require("express");
const router = express.Router();
const {
  getPaymentMethods,
  upsertPaymentMethods,
} = require("../controllers/paymentController");

// Get payment methods by creator_id
router.get("/:creator_id", getPaymentMethods);

// Upsert payment methods (overwrite all for creator)
router.post("/:creator_id", upsertPaymentMethods);

module.exports = router;
