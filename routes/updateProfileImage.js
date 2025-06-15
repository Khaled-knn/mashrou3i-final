const express = require('express');
const router = express.Router();
const db = require('../config/db');
const jwt = require('jsonwebtoken');
const {protect} = require('../middleware/authMiddleware'); 

router.post('/creator/update-profile-image', protect, async (req, res) => {
  const token = req.headers.authorization;
  const imageUrl = req.body.image;

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const creatorId = decoded.id;

    await db.execute(
      'UPDATE creators SET profile_image = ? WHERE id = ?',
      [imageUrl, creatorId]
    );

    res.status(200).json({ message: 'Profile image updated successfully', imageUrl });
  } catch (error) {
    console.error('Error updating profile image:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
