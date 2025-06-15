const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sendNotification = require('../controllers/notificationHelper');
const JWT_SECRET = 'mashrou3i@owner'; 

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await (await db).execute(
      "SELECT * FROM owners WHERE email = ?",
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const owner = rows[0];

    const passwordMatch = await bcrypt.compare(password, owner.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: owner.id, email: owner.email }, JWT_SECRET, {
      expiresIn: '30d',
    });

    res.status(200).json({ message: 'Login successful', token });
  } catch (err) {
    console.error('Error during owner login:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


router.get('/creators', async (req, res) => {
  try {
    const [results] = await (await db).execute(`
    SELECT 
  c.id,
  CONCAT(c.first_name, ' ', c.last_name) AS full_name,
  c.tokens,
  c.deliveryValue,
  COUNT(DISTINCT o.id) AS number_of_orders,
  COUNT(DISTINCT i.id) AS number_of_items,
  c.profile_image AS picture,
  c.status
FROM creators c
LEFT JOIN orders o ON c.id = o.creator_id
LEFT JOIN items i ON c.id = i.creator_id
WHERE c.status IN ('pending', 'approved')
GROUP BY 
  c.id, full_name, c.tokens, c.deliveryValue, c.profile_image, c.status
    `);

    res.status(200).json(results);
  } catch (err) {
    console.error('Error fetching creators:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/approve/:id', async (req, res) => {
    const creatorId = req.params.id;

    let connection; 
    try {
        connection = await db.getConnection(); 
        await connection.beginTransaction(); 

        // 1. Update creator status to 'approved'
        const [updateResult] = await connection.query(
            "UPDATE creators SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [creatorId]
        );

        if (updateResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Creator not found or already approved." });
        }

        // 2. Fetch creator's FCM token and name for notification
        const [creatorInfoRows] = await connection.query(
            "SELECT fcm_token, first_name FROM creators WHERE id = ?", 
            [creatorId]
        );

        if (creatorInfoRows.length > 0 && creatorInfoRows[0].fcm_token) {
            const fcmToken = creatorInfoRows[0].fcm_token;
            const creatorName = creatorInfoRows[0].first_name || 'Creator'; 

            const title = "Account Approved! 🎉";
            const body = `Great news, ${creatorName}! Your account has been successfully approved. You can now start receiving orders.`;
            const data = {
                creatorId: creatorId.toString(),
                type: "account_approved" // Type is part of the data object
            };

            console.log(`[FCM Debug] Attempting to send notification to creator ID: ${creatorId}`);
            console.log(`[FCM Debug] FCM Token: ${fcmToken}`);
            console.log(`[FCM Debug] Notification Payload:`, { title, body, data });

            try {
                await sendNotification(fcmToken, title, body, data);
                console.log(`[FCM Debug] Notification sent successfully for creator ID: ${creatorId}`);

                // ✅ تم تعديل الاستعلام لحفظ الإشعار ليتطابق مع جدول 'notifications'
                await connection.query(
                    `INSERT INTO notifications (creator_id, user_id, order_id, title, body, data) VALUES (?, ?, ?, ?, ?, ?)`,
                    [creatorId, null, null, title, body, JSON.stringify(data)]
                );
                console.log(`[DB Debug] Notification saved to DB for creator ID: ${creatorId}`);

            } catch (notificationError) {
                console.error(`[FCM Debug] Error sending or saving notification for creator ID ${creatorId}:`, notificationError);
            }
        } else {
            console.log(`[FCM Debug] No FCM token found for creator ID: ${creatorId} or creator not found in info rows.`);
        }

        await connection.commit(); 
        res.status(200).json({ success: true, message: 'Creator approved successfully and notification process completed.' });

    } catch (err) {
        if (connection) await connection.rollback(); 
        console.error('Error in approve creator transaction:', err); 
        res.status(500).json({ success: false, error: 'Database error or unexpected error.', details: err.message });
    } finally {
        if (connection) connection.release(); 
    }
});


router.post('/reject/:id', async (req, res) => {
  const creatorId = req.params.id;

  try {
    const [result] = await (await db).execute(
      "UPDATE creators SET status = 'rejected' WHERE id = ?",
      [creatorId]
    );
    res.status(200).json({ message: 'Creator rejected successfully' });
  } catch (err) {
    console.error('Error rejecting creator:', err);
    res.status(500).json({ error: 'Database error' });
  }
});



router.get('/creator/:id', async (req, res) => {
    const creatorId = req.params.id;
    try {
        const [results] = await (await db).execute(`
            SELECT 
                c.id,
                CONCAT(c.first_name, ' ', c.last_name) AS full_name,
                c.tokens,
                c.deliveryValue,
                COUNT(DISTINCT o.id) AS number_of_orders,
                COUNT(DISTINCT i.id) AS number_of_items,
                c.profile_image AS picture,
                c.status,
                c.email, 
                c.phone -- ✅ تم تغيير 'phone_number' إلى 'phone' هنا
            FROM creators c
            LEFT JOIN orders o ON c.id = o.creator_id
            LEFT JOIN items i ON c.id = i.creator_id
            WHERE c.id = ?
            GROUP BY 
                c.id, full_name, c.tokens, c.deliveryValue, c.profile_image, c.status, c.email, c.phone -- ✅ وتم تغييره هنا أيضاً في GROUP BY
        `, [creatorId]);

        if (results.length === 0) {
            return res.status(404).json({ error: 'Creator not found' });
        }

        res.status(200).json(results[0]); 
    } catch (err) {
        console.error(`Error fetching creator ${creatorId}:`, err);
        res.status(500).json({ error: 'Database error' });
    }
});


// DELETE /api/owner/creator/:id - حذف Creator
router.delete('/creator/:id', async (req, res) => {
    const creatorId = req.params.id;
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. (اختياري) يمكنك حذف البيانات المتعلقة بهذا Creator في جداول أخرى أولاً
        // مثال: حذف الطلبات المتعلقة بهذا Creator
        // await connection.query("DELETE FROM orders WHERE creator_id = ?", [creatorId]);
        // await connection.query("DELETE FROM items WHERE creator_id = ?", [creatorId]);

        // 2. حذف Creator نفسه
        const [deleteResult] = await connection.query(
            "DELETE FROM creators WHERE id = ?",
            [creatorId]
        );

        if (deleteResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Creator not found." });
        }

        await connection.commit();
        res.status(200).json({ success: true, message: 'Creator deleted successfully.' });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error(`Error deleting creator ${creatorId}:`, err);
        res.status(500).json({ success: false, error: 'Database error or unexpected error.' });
    } finally {
        if (connection) connection.release();
    }
});

// POST /api/owner/creator/:id/add-coins - إضافة عملات لـ Creator
router.post('/creator/:id/add-coins', async (req, res) => {
    const creatorId = req.params.id;
    const { coinsToAdd } = req.body; 

    if (typeof coinsToAdd !== 'number' || coinsToAdd <= 0) {
        return res.status(400).json({ error: 'Invalid amount of coins to add.' });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const [updateResult] = await connection.query(
            "UPDATE creators SET tokens = tokens + ? WHERE id = ?",
            [coinsToAdd, creatorId]
        );

        if (updateResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Creator not found." });
        }

        const [creatorInfoRows] = await connection.query(
            "SELECT fcm_token, first_name, tokens FROM creators WHERE id = ?", 
            [creatorId]
        );
        
        if (creatorInfoRows.length > 0 && creatorInfoRows[0].fcm_token) {
            const fcmToken = creatorInfoRows[0].fcm_token;
            const creatorName = creatorInfoRows[0].first_name || 'Creator';
            const newTotalCoins = creatorInfoRows[0].tokens; 
            
            const title = "Coins Added! 💰";
            const body = `Hi ${creatorName}, ${coinsToAdd} coins have been added to your account! Your new balance is ${newTotalCoins} coins.`;
            const data = {
                creatorId: creatorId.toString(),
                type: "coins_added", // Type is part of the data object
                amount: coinsToAdd.toString(),
                newBalance: newTotalCoins.toString()
            };
            
            try {
                await sendNotification(fcmToken, title, body, data);
                console.log(`Notification sent for added coins to creator ID: ${creatorId}`);
                
                // ✅ تم تعديل الاستعلام لحفظ الإشعار ليتطابق مع جدول 'notifications'
                await connection.query(
                    `INSERT INTO notifications (creator_id, user_id, order_id, title, body, data) VALUES (?, ?, ?, ?, ?, ?)`,
                    [creatorId, null, null, title, body, JSON.stringify(data)]
                );
                console.log(`[DB Debug] Notification saved to DB for creator ID: ${creatorId}`);

            } catch (notificationError) {
                console.error(`Error sending or saving coins added notification for creator ID ${creatorId}:`, notificationError);
            }
        }

        await connection.commit();
        res.status(200).json({ success: true, message: 'Coins added successfully.', newTokens: creatorInfoRows[0]?.tokens });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error(`Error adding coins to creator ${creatorId}:`, err);
        res.status(500).json({ success: false, error: 'Database error or unexpected error.' });
    } finally {
        if (connection) connection.release();
    }
});


router.post('/add-tokens/:id', async (req, res) => {
    const creatorId = req.params.id;
    const { tokens } = req.body; // Expecting 'tokens' to be a number

    if (typeof tokens !== 'number' || tokens <= 0) {
        return res.status(400).json({ success: false, message: "Invalid token amount provided." });
    }

    let connection; // Declare connection outside try block
    try {
        connection = await db.getConnection(); // Get a connection from the pool
        await connection.beginTransaction(); // Start transaction

        // 1. Add tokens to creator's account
        const [updateResult] = await connection.query(
            "UPDATE creators SET tokens = tokens + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [tokens, creatorId]
        );

        if (updateResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Creator not found." });
        }

        // 2. Fetch creator's FCM token, current tokens, and name for notification
        const [creatorInfoRows] = await connection.query(
            "SELECT fcm_token, business_name, tokens FROM creators WHERE id = ?",
            [creatorId]
        );

        if (creatorInfoRows.length > 0 && creatorInfoRows[0].fcm_token) {
            const fcmToken = creatorInfoRows[0].fcm_token;
            const businessName = creatorInfoRows[0].business_name || 'Creator';
            const currentTokens = creatorInfoRows[0].tokens; // Get updated token amount

            const title = "Tokens Added! 💰";
            const body = `Hello ${businessName}, ${tokens} tokens have been successfully added to your account! Your new balance is ${currentTokens} tokens.`;
            const data = {
                creatorId: creatorId.toString(),
                addedTokens: tokens.toString(),
                newBalance: currentTokens.toString(),
                type: "tokens_added"
            };

            // Assuming sendNotification function is available
            await sendNotification(fcmToken, title, body, data);

            // Save notification to database
            await connection.query(
                `INSERT INTO notifications (creator_id, title, body, data, type) VALUES (?, ?, ?, ?, ?)`,
                [creatorId, title, body, JSON.stringify(data), 'tokens_recharge']
            );
        }

        await connection.commit(); // Commit the transaction
        res.status(200).json({ success: true, message: `Tokens added successfully to creator ${creatorId} and notification sent.` });

    } catch (err) {
        if (connection) await connection.rollback(); // Rollback on error
        console.error('Error adding tokens:', err);
        res.status(500).json({ success: false, error: 'Database error or notification error.', details: err.message });
    } finally {
        if (connection) connection.release(); // Release the connection
    }
});


module.exports = router;