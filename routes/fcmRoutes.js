// fcmRoutes.js (المسار: project_root/routes/fcmRoutes.js)
const express = require('express');
const router = express.Router();
const fcmController = require('../controllers/fcmController'); // تأكد إن هذا المسار صحيح

router.post('/update-fcm-token', fcmController.updateFcmToken);

module.exports = router;