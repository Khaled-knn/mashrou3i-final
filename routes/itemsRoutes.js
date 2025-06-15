// routes/itemsRoutes.js
const express = require('express');
const router = express.Router();
const itemsController = require('../controllers/itemsController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.delete('/:id', itemsController.deleteItem);
router.put('/:id', itemsController.updateItem);
router.get('/', itemsController.getItems);

module.exports = router;