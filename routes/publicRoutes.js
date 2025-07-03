// routes/publicRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db'); // تأكد أن هذا المسار صحيح لقاعدة البيانات الخاصة بك

/**
 * @route GET /api/public/advertisements/active
 * @desc Get only active advertisements for public display (users)
 * @access Public
 */
router.get('/advertisements/active', async (req, res) => {
    try {
        // نختار فقط الإعلانات التي is_active = TRUE وتاريخ انتهائها لم يأتِ بعد أو هو اليوم
        const [rows] = await (await db).execute(`
            SELECT id, image_url, redirect_url
            FROM Advertisements
            WHERE is_active = TRUE AND end_date >= CURRENT_DATE()
            ORDER BY created_at DESC
        `);
        res.json({ success: true, advertisements: rows });
    } catch (error) {
        console.error('Error fetching public active advertisements:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch public active advertisements.' });
    }
});

module.exports = router;