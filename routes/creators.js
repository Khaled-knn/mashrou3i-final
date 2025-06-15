const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const Joi = require('joi');
const jwt = require('jsonwebtoken');
const { protect } = require('../middleware/authMiddleware');

const validateRegisterData = (data) => {
  const schema = Joi.object({
    profession_id: Joi.number().integer().required(),
    first_name: Joi.string().min(2).max(50).required(),
    last_name: Joi.string().min(2).max(50).required(),
    email: Joi.string().email().required(),
    phone: Joi.string().required(),
    store_name: Joi.string().min(5).max(100).required(),
    password: Joi.string().min(8).pattern(new RegExp('^[a-zA-Z0-9!@#$%^&*()_+]{8,}$')).required(),
  });
  return schema.validate(data);
};

router.post('/register', async (req, res) => {
  const { profession_id, first_name, last_name, email, phone, store_name, password } = req.body;

  const { error } = validateRegisterData(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  try {
    const [rows] = await db.execute('SELECT * FROM creators WHERE email = ?', [email]);
    if (rows.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }


    const hashedPassword = await bcrypt.hash(password, 10);

  
    const [result] = await db.execute(`
      INSERT INTO creators (profession_id, first_name, last_name, email, phone, store_name, password, tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [profession_id, first_name, last_name, email, phone, store_name, hashedPassword, 0]
    );


    const token = jwt.sign(
      { id: result.insertId, email, role: 'creator' },  
      process.env.JWT_SECRET,
      { expiresIn: '30d' }    
    );

    return res.status(201).json({
      message: 'Creator registered successfully',
      creatorId: result.insertId,
      token: token,  
    });

  } catch (err) {
    console.error("Server error:", err.message);
    res.status(500).json({ error: err.message });
  }
});





router.post('/creator/update-name', protect, async (req, res) => {
  const creatorId = req.user.id;
  const newName = req.body.name;
  const cost = 5; // تكلفة تغيير الاسم

  try {
    const [creatorRows] = await db.execute( // غيرت `coinsRows` لـ `creatorRows` للوضوح
      'SELECT tokens FROM creators WHERE id = ?',
      [creatorId]
    );

    if (creatorRows.length === 0) {
      return res.status(404).json({ error: 'Creator not found' });
    }

    // 🚀 التحويل الآمن لقيمة tokens
    const currentTokens = parseFloat(creatorRows[0].tokens); 
    if (isNaN(currentTokens)) {
      console.error(`Invalid tokens value for creator ${creatorId}: ${creatorRows[0].tokens}`);
      return res.status(500).json({ error: 'Invalid tokens value retrieved from database' });
    }

    console.log(`Current tokens for creator ${creatorId}: ${currentTokens}`); // Debug log

    if (currentTokens < cost) {
      return res.status(400).json({
        error: 'Insufficient tokens to change store name', // رسالة خطأ أكثر وضوحاً
        required: cost,
        available: currentTokens
      });
    }

    // 🚀 تحديث اسم المتجر وخصم التوكنات وتحديث updated_at
    await db.execute(
      'UPDATE creators SET store_name = ?, tokens = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newName, currentTokens - cost, creatorId] // `currentTokens - cost` هي قيمة double
    );
    console.log(`Store name updated for creator ${creatorId} to ${newName}. Deducted ${cost} tokens.`);

    res.status(200).json({
      message: 'Store name updated successfully',
      newName: newName,
      remainingTokens: currentTokens - cost // تغيير `remainingCoins` لـ `remainingTokens` للاتساق
    });

  } catch (error) {
    console.error('Error updating store name:', error); // رسالة خطأ أكثر تحديداً
    res.status(500).json({
      success: false, // إضافة success: false للاتساق مع باقي الـ responses
      message: 'An internal server error occurred while updating the store name.', // رسالة للمستخدم
      error: error.message // تفاصيل الخطأ للمطورين في بيئة التطوير
    });
  }
});
module.exports = router;
