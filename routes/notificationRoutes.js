const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController'); 
const { protect } = require('../middleware/authMiddleware');

router.get('/user-notifications', protect, notificationController.getUserNotifications);
router.put('/notifications/:notificationId/read', protect, notificationController.markNotificationAsRead);
router.delete('/notifications/:notificationId', protect, notificationController.deleteNotification);

    
router.get('/creator-notifications', protect, notificationController.getCreatorNotifications);
module.exports = router;
