const db = require('../config/db');
const bcrypt = require('bcryptjs');

exports.register = async (req, res) => {
  const { first_name, last_name, email, password, phone } = req.body;

  if (!first_name || !last_name || !email || !password || !phone) {
    return res.status(400).json({ message: 'الرجاء ملء جميع الحقول' });
  }
  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err) return res.status(500).json({ message: 'خطأ في الخادم' });
    if (results.length > 0) {
      return res.status(400).json({ message: 'البريد الإلكتروني مسجل مسبقًا' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = {
      first_name,
      last_name,
      email,
      password: hashedPassword,
      phone
    };

    db.query('INSERT INTO users SET ?', user, (err, result) => {
      if (err) return res.status(500).json({ message: 'فشل إنشاء المستخدم' });
      res.status(201).json({ message: 'تم التسجيل بنجاح', userId: result.insertId });
    });
  });
};


