
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');
const router = express.Router();
router.post('/login/creator', async (req, res) => {
    const { email, password } = req.body;
  
    if (!email || !password) {
      return res.status(400).json({ error: 'Please provide email and password' });
    }
  
    try {
      const [rows] = await db.execute('SELECT * FROM creators WHERE email = ?', [email]);
  
      if (rows.length === 0) {
        return res.status(400).json({ error: 'Invalid email or password' });
      }
  
      const creator = rows[0];
  
      const isMatch = await bcrypt.compare(password, creator.password);
      if (!isMatch) {
        return res.status(400).json({ error: 'Invalid email or password' });
      }
  
      const token = jwt.sign(
        { id: creator.id, email: creator.email, role: 'creator' },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
      );
  
      res.status(200).json({
        message: 'Login successful',
        creatorId: creator.id,
        token: token,
        status: creator.status,
      });
  
    } catch (err) {
      console.error('Login error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });
  module.exports = router;