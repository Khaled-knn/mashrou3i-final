const express = require("express");
const router = express.Router();
const AddressController = require("../controllers/addressController");
const { protect } = require("../middleware/authMiddleware");

router.post("/", protect, AddressController.upsertAddress);
router.get("/:creator_id", protect, AddressController.getAddress); 
module.exports = router;
