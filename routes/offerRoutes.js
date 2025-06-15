const express = require("express");
const router = express.Router();
const {
  getOffer,
  upsertOffer,
} = require("../controllers/offerController");

// Get offer for a creator
router.get("/:creator_id", getOffer);

// Upsert offer for a creator
router.post("/:creator_id", upsertOffer);

module.exports = router;
