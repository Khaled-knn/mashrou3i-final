// routes/tokenRequestsRoutes.js
const express = require('express');
const router = express.Router();
const tokenRequestsController = require('../controllers/tokenRequestsController');
const { protect } = require('../middleware/authMiddleware'); // استورد middleware المصادقة الخاص بك

// تطبيق الـ middleware لـ 'protect' على جميع المسارات في هذا الراوتر.
// هذا يعني أن أي طلب يصل إلى هذا الراوتر يجب أن يكون مصادق عليه (authenticated).
router.use(protect);

// تعريف المسار (Endpoint) لإنشاء طلب توكن جديد.
// هذا المسار سيستقبل طلبات POST على المسار الرئيسي للراوتر (والذي سيتم تعريفه لاحقاً في app.js).
// مثلاً، إذا ربطت هذا الراوتر بـ '/api/token-requests'، فإن هذا المسار سيكون '/api/token-requests/'.
router.post('/', tokenRequestsController.createTokenRequest);

module.exports = router;