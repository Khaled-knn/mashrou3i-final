const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const jwt = require('jsonwebtoken');

router.get('/creator/:id', async (req, res) => {
  const creatorId = req.params.id;

  try {
    const [rows] = await db.execute(
      `SELECT id, profession_id, first_name, last_name, email, phone, store_name, profile_image, 
              cover_photo, status, created_at, tokens, delivery_type, 
              monthly_income, deliveryValue 
       FROM creators 
       WHERE id = ?`,
      [creatorId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Creator not found' });
    }

    res.status(200).json(rows[0]);
  } catch (err) {
    console.error('Error fetching creator:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ Get logged-in creator profile
router.get('/creator-profile', protect, async (req, res) => {
  const userId = req.user.id;

  try {
    const [rows] = await db.execute(
      `SELECT id, profession_id, first_name, last_name, email, phone, store_name, profile_image, 
              cover_photo, status, created_at, tokens, delivery_type, 
              monthly_income, deliveryValue 
       FROM creators 
       WHERE id = ?`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Creator not found' });
    }

    res.status(200).json(rows[0]);
  } catch (err) {
    console.error('Invalid token:', err.message);
    res.status(400).json({ error: 'Invalid token' });
  }
});

// ✅ Update profile fields (requires login)
router.put('/creator-profile/update', protect, async (req, res) => {
  const userId = req.user.id;

  const {
    profile_image,
    cover_photo,
    monthly_income,
    deliveryValue
  } = req.body;

  try {
    const [result] = await db.execute(
      `UPDATE creators SET 
         profile_image = ?, 
         cover_photo = ?, 
         monthly_income = ?, 
         deliveryValue = ?
       WHERE id = ?`,
      [
        profile_image || 'https://static.vecteezy.com/system/resources/previews/027/708/418/non_2x/default-avatar-profile-icon-in-flat-style-free-vector.jpg',
        cover_photo || 'https://flowbite.com/docs/images/examples/image-3@2x.jpg',
        monthly_income || 0.00,
        deliveryValue || 0.00,
        userId
      ]
    );

    res.status(200).json({ message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Error updating profile:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
