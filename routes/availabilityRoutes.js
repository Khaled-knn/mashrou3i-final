const express = require("express");
const router = express.Router();
const {
  upsertAvailability,
  getAvailability,
} = require("../controllers/availabilityController");

// Create or update availability
router.post("/:creator_id", upsertAvailability);

// Get availability by creator_id
router.get("/:creator_id", getAvailability);

module.exports = router;
