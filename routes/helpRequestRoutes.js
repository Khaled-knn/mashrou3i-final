// routes/helpRequestRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');

const { protect } = require('../middleware/authMiddleware'); // تأكد من المسار الصحيح



router.post('/requests', protect, async (req, res) => { // استخدم authenticateUser هنا
    const { message } = req.body;
    const userId = req.user.id; // يتم الحصول على user ID من التوكن بعد المصادقة

    if (!message) {
        return res.status(400).json({ success: false, message: 'Message is required.' });
    }

    try {
        const [result] = await (await db).execute(
            'INSERT INTO HelpRequests (user_id, message) VALUES (?, ?)',
            [userId, message]
        );
        res.status(201).json({ success: true, message: 'Help request submitted successfully!', requestId: result.insertId });
    } catch (error) {
        console.error('Error submitting help request:', error);
        res.status(500).json({ success: false, message: 'Failed to submit help request.' });
    }
});



module.exports = router;