// routes/cartRoutes.js
const express = require("express");
const router = express.Router();
const cartController = require("../controllers/cartController");


const { protect } = require("../middleware/authMiddleware"); 



router.post("/add", protect, cartController.addToCart); 


router.get("/:userId", protect, cartController.getUserCart);


router.delete("/remove/:cartId", protect, cartController.removeFromCart);


router.put("/update-quantity/:cartId", protect, cartController.updateCartItemQuantity);


router.delete("/clear/:userId", protect, cartController.clearUserCart);


module.exports = router;