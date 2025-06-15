const express = require('express');
const router = express.Router();
const { deleteItem } = require('../controllers/creatorItemsController'); // استيراد مباشر للدالة
const authMiddleware = require('../middleware/authMiddleware');

router.delete('/:id', authMiddleware, deleteItem);

module.exports = router;