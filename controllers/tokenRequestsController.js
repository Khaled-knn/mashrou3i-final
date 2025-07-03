// controllers/tokenRequestsController.js
const TokenRequestsService = require('../services/tokenRequestsService'); // رح ننشئ هذا الملف قريباً

const tokenRequestsController = {
    async createTokenRequest(req, res) {
        try {
            // req.user.id هو ID الكريتور اللي عم يرسل الطلب (من الـ authMiddleware)
            const creatorId = req.user.id;
            const { amount } = req.body; // قيمة التوكنز اللي بدو ياخدها من الـ body

            if (!amount || typeof amount !== 'number' || amount <= 0) {
                return res.status(400).json({ message: 'Amount is required and must be a positive number.' });
            }

            // استدعاء الخدمة لإنشاء الطلب وإرسال الإيميل
            const requestId = await TokenRequestsService.createRequestAndNotifyOwner(creatorId, amount);

            res.status(201).json({
                success: true,
                message: 'Token request submitted successfully and owner notified.',
                requestId: requestId
            });

        } catch (error) {
            console.error('Error in createTokenRequest:', error);
            // تحديد الـ status code بناءً على نوع الخطأ
            const statusCode = error.message.includes('not found') || error.message.includes('invalid') ? 400 : 500;
            res.status(statusCode).json({ success: false, message: error.message });
        }
    }
};

module.exports = tokenRequestsController;