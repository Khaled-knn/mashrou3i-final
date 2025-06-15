const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const itemController = require('../controllers/itemController');

router.post('/items', protect, itemController.addItem);

router.get('/search', itemController.searchItems);


module.exports = router;