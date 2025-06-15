const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware'); // تأكد من المسار النسبي الصحيح لـ authMiddleware
const orderController = require('../controllers/ordersController');

router.post('/place', protect, orderController.placeOrder);

router.put('/:orderId/creator-action', protect, orderController.acceptOrCancelOrder);


router.put('/:orderId/confirm-payment', protect, orderController.userConfirmsPayment);


router.get('/creator', protect, orderController.getCreatorOrders);



router.get('/user-orders', protect, orderController.getUserOrders);


module.exports = router; 