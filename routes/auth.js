const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { protect } = require("../middleware/authMiddleware");
const db = require('../config/db');

// Register
router.post(
  '/register/user',
  [
    body('first_name').notEmpty(),
    body('last_name').notEmpty(),
    body('email').isEmail(),
    body('password').isLength({ min: 6 }),
    body('phone').isMobilePhone('any')
  ],
  authController.register
);

// Verify Email
router.get('/verify-email', authController.verifyEmail);



// Login
router.post(
  '/login/user',
  [
    body('email').isEmail(),
    body('password').notEmpty()
  ],
  authController.login
);

// Forgot password
router.post(
  '/forgot-password',
  [body('email').isEmail()],
  authController.forgotPassword
);

// Reset password
router.post(
  '/reset-password',
  [
    body('token').notEmpty(),
    body('new_password').isLength({ min: 6 })
  ],
  authController.resetPassword
);

// Profile







router.put(
    '/change-password',
    protect,
    [
        body('current_password').notEmpty().withMessage('كلمة المرور الحالية مطلوبة'),
        body('new_password').isLength({ min: 6 }).withMessage('يجب أن تكون كلمة المرور الجديدة 6 أحرف على الأقل')
    ],
    authController.changePassword
);



router.put(
  '/profile',
  protect, // 👈 استخدام الـ middleware لحماية الـ route
  [
    body('first_name').optional().notEmpty(), // جعل الاسم اختياري للتحديث
    body('last_name').optional().notEmpty(),
    body('email').optional().isEmail(),
    body('phone').optional().isMobilePhone('any'),
    body('city').optional().notEmpty(),
    body('street').optional().notEmpty(),
    body('country').optional().notEmpty() // إضافة التحقق من الـ 'country'
  ],
  authController.updateProfile
);

  

router.post('/google-signin', authController.signInWithGoogle);

module.exports = router;
