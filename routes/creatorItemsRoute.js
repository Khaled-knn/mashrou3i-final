const express = require('express');
const router = express.Router();
const { fetchMyItems } = require('../controllers/creatorItemsController');
const { protect } = require('../middleware/authMiddleware');


router.get('/my-items', protect, fetchMyItems);

module.exports = router;
