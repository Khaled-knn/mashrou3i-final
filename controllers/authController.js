const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const generateToken = require('../utils/generateToken'); // This generates random strings
const emailService = require('../services/emailService');
const admin = require('../config/firebaseAdmin'); // For Google sign-in





exports.register = async (req, res) => {
  // إضافة 'country' لمتغيرات الـ body
  const { first_name, last_name, email, password, phone, city, street, country } = req.body;
  try {
    // Check if user already exists
    const [existingUser] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser.length > 0) {
      return res.status(400).json({ message: 'Email already in use.' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Generate verification token (random string)
    const verification_token = generateToken(20);

    // Insert user and get the newly generated ID
    // 🎯 إضافة حقول city, street, country إلى الـ INSERT statement
    const [result] = await db.query(
      `INSERT INTO users (first_name, last_name, email, password, phone, city, street, country, verification_token, is_verified, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [first_name, last_name, email, hashedPassword, phone, city, street, country, verification_token, 'email']
    );

    const userId = result.insertId;

    const [newUserRows] = await db.query(
      'SELECT id, first_name, last_name, email, phone, city, street, country, points, is_verified FROM users WHERE id = ?',
      [userId]
    );
    const newUser = newUserRows[0];

    const token = jwt.sign(
      { id: newUser.id, email: newUser.email },
      process.env.JWT_SECRET || 'your_jwt_secret',
      { expiresIn: '90d' }
    );

    // Send verification email
    await emailService.sendVerificationEmail(email, verification_token);

    // 🎯 الاستجابة النهائية: إرجاع رسالة، بيانات المستخدم، والتوكن
    res.status(201).json({
      message: 'User registered successfully. Please verify your email.',
      user: {
        id: newUser.id,
        first_name: newUser.first_name,
        last_name: newUser.last_name,
        email: newUser.email,
        phone: newUser.phone,
        city: newUser.city, // 👈 إضافة الحقل
        street: newUser.street, // 👈 إضافة الحقل
        country: newUser.country, // 👈 إضافة الحقل
        points: newUser.points,
        is_verified: newUser.is_verified
      },
      token: token
    });
  } catch (err) {
    console.error('Error during user registration:', err);
    res.status(500).json({ message: 'Internal Server Error.', error: err.message });
  }
};

exports.verifyEmail = async (req, res) => {
  const { token } = req.query; // The token here is the random string generated
  try {
    // Verify the token directly from the database
    const [user] = await db.query('SELECT id FROM users WHERE verification_token = ?', [token]);
    if (user.length === 0) {
      return res.status(400).json({ message: 'Invalid verification token.' });
    }

    // Activate user and clear the verification token
    await db.query('UPDATE users SET is_verified = 1, verification_token = NULL WHERE id = ?', [user[0].id]);

    res.json({ message: 'Email verified successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error.' });
  }
};


exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    // 🎯 جلب كل الحقول (أو الحقول المطلوبة) من المستخدم
    const [userRows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

    if (userRows.length === 0) {
      return res.status(401).json({ message: 'Email address not found.' });
    }

    const user = userRows[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid password.' });
    }

    console.log('JWT_SECRET used for SIGNING (login):', process.env.JWT_SECRET);
    const token = jwt.sign(
      { id: user.id, email: user.email, provider: user.provider },
      process.env.JWT_SECRET || 'your_jwt_secret',
      { expiresIn: '1d' }
    );

    // إرجاع التوكن وبيانات المستخدم مع city, street, country
    res.json({
      token,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        phone: user.phone,
        city: user.city, // 👈 إضافة الحقل
        street: user.street, // 👈 إضافة الحقل
        country: user.country, // 👈 إضافة الحقل
        points: user.points,
        is_verified: user.is_verified,
        provider: user.provider
      }
    });
  } catch (err) {
    console.error('Error during user login:', err);
    res.status(500).json({ message: 'Internal Server Error.', error: err.message });
  }
};


exports.signInWithGoogle = async (req, res) => {
  const { idToken } = req.body;

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid, email, name, picture } = decodedToken;

    const [existingUser] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

    let userRecord;
    if (existingUser.length === 0) {
      const hashedPassword = await bcrypt.hash('google_user_password_dummy_12345', 12);
      const [result] = await db.query(
        `INSERT INTO users (first_name, last_name, email, password, provider_id, is_verified, provider) VALUES (?, ?, ?, ?, ?, 1, ?)`,
        [name ? name.split(' ')[0] : '', name ? name.split(' ').slice(1).join(' ') : '', email, hashedPassword, uid, 'google']
      );
      userRecord = {
        id: result.insertId,
        first_name: name ? name.split(' ')[0] : '',
        last_name: name ? name.split(' ').slice(1).join(' ') : '',
        email: email,
        phone: null,
        city: null, // 👈 إضافة الحقل
        street: null, // 👈 إضافة الحقل
        country: null, // 👈 إضافة الحقل
        points: 0,
        is_verified: 1,
        provider_id: uid,
        provider: 'google'
      };
    } else {
      userRecord = existingUser[0];
      if (!userRecord.provider_id || userRecord.provider !== 'google') {
        await db.query('UPDATE users SET provider_id = ?, provider = ? WHERE id = ?', [uid, 'google', userRecord.id]);
        userRecord.provider_id = uid;
        userRecord.provider = 'google';
      }
    }

    const backendToken = jwt.sign(
      { id: userRecord.id, email: userRecord.email, provider: userRecord.provider },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      token: backendToken,
      user: {
        id: userRecord.id,
        first_name: userRecord.first_name,
        last_name: userRecord.last_name,
        email: userRecord.email,
        phone: userRecord.phone,
        city: userRecord.city, // 👈 إضافة الحقل
        street: userRecord.street, // 👈 إضافة الحقل
        country: userRecord.country, // 👈 إضافة الحقل
        points: userRecord.points,
        is_verified: userRecord.is_verified,
        provider: userRecord.provider
      }
    });

  } catch (err) {
    console.error('Error during Google sign-in backend:', err);
    if (err.code && err.code.startsWith('auth/')) {
      return res.status(401).json({ message: 'Invalid or expired Google ID Token.' });
    }
    res.status(500).json({ message: 'Internal Server Error' });
  }
};




  
exports.resetPassword = async (req, res) => {
  const { token, new_password } = req.body;
  try {
    // جلب المستخدم والتوكن ووقت انتهائه
    const [userRows] = await db.query(
      'SELECT id, reset_password_expires FROM users WHERE reset_password_token = ?',
      [token]
    );

    // التحقق من وجود التوكن
    if (userRows.length === 0) {
      return res.status(400).json({ message: 'Invalid or missing reset token.' });
    }

    const user = userRows[0];

    // 🎯 التحقق من صلاحية التوكن (لم ينتهي بعد)
    if (user.reset_password_expires && new Date(user.reset_password_expires) < new Date()) {
      // إذا انتهت صلاحية التوكن، قم بمسحه من قاعدة البيانات
      await db.query('UPDATE users SET reset_password_token = NULL, reset_password_expires = NULL WHERE id = ?', [user.id]);
      return res.status(400).json({ message: 'Reset token has expired. Please request a new password reset link.' });
    }

    // تشفير كلمة المرور الجديدة
    const hashedPassword = await bcrypt.hash(new_password, 12);

    // تحديث كلمة المرور ومسح التوكن ووقت انتهاء الصلاحية
    await db.query(
      'UPDATE users SET password = ?, reset_password_token = NULL, reset_password_expires = NULL WHERE id = ?',
      [hashedPassword, user.id]
    );

    res.json({ message: 'Password has been reset successfully. You can now log in with your new password.' });
  } catch (err) {
    console.error('Error in resetPassword:', err);
    res.status(500).json({ message: 'Internal Server Error.' });
  }
};



exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const [userRows] = await db.query('SELECT id FROM users WHERE email = ?', [email]);

    // رسالة عامة دائماً لأسباب أمنية
    if (userRows.length === 0) {
      return res.status(200).json({ message: 'If a user with that email exists, a password reset link has been sent to it.' });
    }
    const user = userRows[0];

    // توليد توكن إعادة تعيين كلمة المرور
    const reset_password_token = generateToken(20);

    // 🎯 تحديد وقت انتهاء الصلاحية (ساعة واحدة من الآن)
    const reset_password_expires = new Date(Date.now() + 3600000); // 3600000 milliseconds = 1 hour

    // تحديث التوكن ووقت انتهاء الصلاحية في قاعدة البيانات
    await db.query(
      'UPDATE users SET reset_password_token = ?, reset_password_expires = ? WHERE id = ?',
      [reset_password_token, reset_password_expires, user.id]
    );

    // إرسال إيميل إعادة تعيين كلمة المرور باستخدام الدالة اللي عدلناها
    await emailService.sendResetPasswordEmail(email, reset_password_token);

    res.status(200).json({ message: 'If a user with that email exists, a password reset link has been sent to it.' });
  } catch (err) {
    console.error('Error in forgotPassword:', err);
    res.status(500).json({ message: 'Internal Server Error.' });
  }
};



exports.changePassword = async (req, res) => {
  const { current_password, new_password } = req.body;
  const userId = req.user.id; // Assuming req.user is populated by authMiddleware

  try {
    // Fetch user to check current password and provider type
    const [users] = await db.query('SELECT password, provider FROM users WHERE id = ?', [userId]);

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const user = users[0];

    // Check if the user signed in via a social provider (Google, Facebook, Apple, etc.)
    const isSocialProvider = (user.provider && user.provider !== 'email'); // Any provider other than 'email' is considered social

    if (isSocialProvider) {
      // For social providers: do not require current_password.
      // Just validate that new_password exists and meets length requirements.
      if (!new_password || new_password.length < 6) {
        return res.status(400).json({ message: 'New password must be at least 6 characters long.' });
      }
    } else {
      // For traditional email/password users: require current_password
      if (!current_password) {
        return res.status(400).json({ message: 'Current password is required.' });
      }
      const isMatch = await bcrypt.compare(current_password, user.password);
      if (!isMatch) {
        return res.status(400).json({ message: 'Current password is incorrect.' });
      }
      // Also validate the new password length
      if (!new_password || new_password.length < 6) {
        return res.status(400).json({ message: 'New password must be at least 6 characters long.' });
      }
    }

    // Hash the new password
    const hashedNewPassword = await bcrypt.hash(new_password, 12);

    // Update password in the database
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedNewPassword, userId]);

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('Error changing password:', err);
    res.status(500).json({ message: 'Internal Server Error.' });
  }
};



exports.updateProfile = async (req, res) => {
  const userId = req.user.id; // نفترض أن الـ userId متاح من الـ authentication middleware
  const { first_name, last_name, email, phone, city, street, country } = req.body;

  try {
    // جلب بيانات المستخدم الحالية
    const [userRows] = await db.query('SELECT first_name, last_name, email, last_name_change_date FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }
    const currentUser = userRows[0];

    const updates = {};
    const params = [];
    let nameChanged = false;

    // التحقق من البريد الإلكتروني (إذا تغير)
    if (email && email !== currentUser.email) {
      const [existingEmail] = await db.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, userId]);
      if (existingEmail.length > 0) {
        return res.status(400).json({ message: 'Email already in use by another account.' });
      }
      updates.email = email;
      params.push(email);
    }

    // التحقق من الاسم الأول أو الأخير
    if ((first_name && first_name !== currentUser.first_name) || (last_name && last_name !== currentUser.last_name)) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // إذا كان المستخدم قد غير اسمه مؤخراً، أو إذا لم يقم بتغييره أبداً (last_name_change_date NULL)
      if (currentUser.last_name_change_date && new Date(currentUser.last_name_change_date) > thirtyDaysAgo) {
        // حساب الأيام المتبقية
        const nextChangeDate = new Date(currentUser.last_name_change_date);
        nextChangeDate.setDate(nextChangeDate.getDate() + 30);
        const timeLeft = Math.ceil((nextChangeDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
        return res.status(400).json({ message: `You can only change your name every 30 days. Please wait ${timeLeft} days.` });
      }
      
      if (first_name) {
        updates.first_name = first_name;
        params.push(first_name);
      }
      if (last_name) {
        updates.last_name = last_name;
        params.push(last_name);
      }
      updates.last_name_change_date = new Date(); // تحديث تاريخ آخر تغيير
      params.push(updates.last_name_change_date);
      nameChanged = true;
    }

    // تحديث الحقول الأخرى
    if (phone) {
      updates.phone = phone;
      params.push(phone);
    }
    if (city) {
      updates.city = city;
      params.push(city);
    }
    if (street) {
      updates.street = street;
      params.push(street);
    }
    if (country) { // 👈 تغيير هنا من village إلى country
      updates.country = country;
      params.push(country);
    }

    // بناء الـ SQL query بشكل ديناميكي
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No fields provided for update.' });
    }

    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    params.push(userId); // الـ userId يكون آخر parameter في الـ WHERE clause

    await db.query(`UPDATE users SET ${setClause} WHERE id = ?`, params);

    // جلب بيانات المستخدم المحدثة لإرجاعها
    // 🎯 إضافة حقول city, street, country, provider إلى الـ SELECT statement
    const [updatedUserRows] = await db.query(
      'SELECT id, first_name, last_name, email, phone, city, street, country, points, is_verified, provider FROM users WHERE id = ?',
      [userId]
    );
    const updatedUser = updatedUserRows[0];

    res.status(200).json({
      message: 'Profile updated successfully.',
      user: {
        id: updatedUser.id,
        first_name: updatedUser.first_name,
        last_name: updatedUser.last_name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        city: updatedUser.city,
        street: updatedUser.street,
        country: updatedUser.country, // 👈 تغيير هنا
        points: updatedUser.points,
        is_verified: updatedUser.is_verified,
        provider: updatedUser.provider
      }
    });

  } catch (err) {
    console.error('Error updating user profile:', err);
    res.status(500).json({ message: 'Internal Server Error.', error: err.message });
  }
};