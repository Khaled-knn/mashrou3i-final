const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// تأكد أن هذا المسار صحيح وأن sendNotification يحتوي على sendNotification, sendNotificationToCreator, sendNotificationToUser
const { sendNotification, sendNotificationToCreator, sendNotificationToUser } = require('../controllers/notificationHelper'); 

const JWT_SECRET = 'mashrou3i@owner'; // سر التوقيع الخاص بتوكنات المالكين

// -----------------------------------------------------
// Owner Authentication Routes (لا تحتاج مصادقة لعملية تسجيل الدخول نفسها)
// -----------------------------------------------------

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

        const token = jwt.sign({ id: owner.id, email: owner.email, role: 'owner' }, JWT_SECRET, {
            expiresIn: '30d',
        });

        res.status(200).json({ message: 'Login successful', token, owner: { id: owner.id, email: owner.email } });
    } catch (err) {
        console.error('Error during owner login:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// -----------------------------------------------------
// Middleware for Owner Authentication & Authorization (تعريفات داخل الملف)
// -----------------------------------------------------

const authenticateOwnerToken = (req, res, next) => { // غيرت الاسم لتجنب الالتباس مع أي authenticateToken آخر
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.sendStatus(401); // No token provided

    jwt.verify(token, JWT_SECRET, (err, owner) => {
        if (err) {
            console.error("JWT Verification Error (Owner):", err.message);
            return res.sendStatus(403); // Forbidden, token is invalid or expired
        }
        req.owner = owner; // Store owner info in req.owner
        next();
    });
};

const checkOwnerRole = (roles) => {
    return (req, res, next) => {
        if (!req.owner || !req.owner.role || !roles.includes(req.owner.role)) {
            return res.status(403).json({ message: 'Forbidden: Insufficient permissions (Owner Role Check)' });
        }
        next();
    };
};

// -----------------------------------------------------
// تطبيق Middleware للمسارات المحمية فقط
// أي مسار يأتي بعد هذا السطر سيحتاج لمصادقة المالك ودوره.
// -----------------------------------------------------
router.use(authenticateOwnerToken);
router.use(checkOwnerRole(['owner']));

// -----------------------------------------------------
// Protected Owner Routes (Accessible by Owner only after authentication)
// -----------------------------------------------------

// Creator Management Routes
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
            WHERE c.status IN ('pending', 'approved', 'rejected')
            GROUP BY
                c.id, full_name, c.tokens, c.deliveryValue, c.profile_image, c.status
            ORDER BY c.created_at DESC
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
        const [updateResult] = await connection.query(
            "UPDATE creators SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [creatorId]
        );
        if (updateResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Creator not found or already approved." });
        }
        const [creatorInfoRows] = await connection.query(
            "SELECT fcm_token, first_name FROM creators WHERE id = ?",
            [creatorId]
        );
        if (creatorInfoRows.length > 0 && creatorInfoRows[0].fcm_token) {
            const fcmToken = creatorInfoRows[0].fcm_token;
            const creatorName = creatorInfoRows[0].first_name || 'Creator';
            const title = "Account Approved! 🎉";
            const body = `Great news, ${creatorName}! Your account has been successfully approved. You can now start receiving orders.`;
            const data = { creatorId: creatorId.toString(), type: "account_approved" };
            console.log(`[FCM Debug] Attempting to send notification to creator ID: ${creatorId}`);
            console.log(`[FCM Debug] FCM Token: ${fcmToken}`);
            console.log(`[FCM Debug] Notification Payload:`, { title, body, data });
            try {
                await sendNotification(fcmToken, title, body, data); // استخدام sendNotification مباشرة
                console.log(`[FCM Debug] Notification sent successfully for creator ID: ${creatorId}`);
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
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [updateResult] = await connection.query(
            "UPDATE creators SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [creatorId]
        );
        if (updateResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Creator not found or already rejected." });
        }
        const [creatorInfoRows] = await connection.query(
            "SELECT fcm_token, first_name FROM creators WHERE id = ?",
            [creatorId]
        );
        if (creatorInfoRows.length > 0 && creatorInfoRows[0].fcm_token) {
            const fcmToken = creatorInfoRows[0].fcm_token;
            const creatorName = creatorInfoRows[0].first_name || 'Creator';
            const title = "Account Status Update ⚠️";
            const body = `Hello ${creatorName}, unfortunately, your account application has been rejected. Please contact support for more details.`;
            const data = { creatorId: creatorId.toString(), type: "account_rejected" };
            try {
                await sendNotification(fcmToken, title, body, data);
                await connection.query(
                    `INSERT INTO notifications (creator_id, user_id, order_id, title, body, data) VALUES (?, ?, ?, ?, ?, ?)`,
                    [creatorId, null, null, title, body, JSON.stringify(data)]
                );
            } catch (notificationError) {
                console.error(`Error sending or saving rejection notification for creator ID ${creatorId}:`, notificationError);
            }
        }
        await connection.commit();
        res.status(200).json({ success: true, message: 'Creator rejected successfully and notification process completed.' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error rejecting creator:', err);
        res.status(500).json({ success: false, error: 'Database error.', details: err.message });
    } finally {
        if (connection) connection.release();
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
                c.phone
            FROM creators c
            LEFT JOIN orders o ON c.id = o.creator_id
            LEFT JOIN items i ON c.id = i.creator_id
            WHERE c.id = ?
            GROUP BY
                c.id, full_name, c.tokens, c.deliveryValue, c.profile_image, c.status, c.email, c.phone
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

router.delete('/creator/:id', async (req, res) => {
    const creatorId = req.params.id;
    let connection;
    try {
        console.log("Deleting creator id:", creatorId);
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [ordersDeleteResult] = await connection.query("DELETE FROM orders WHERE creator_id = ?", [creatorId]);
        console.log(`Deleted ${ordersDeleteResult.affectedRows} rows from orders`);
        const [notificationsDeleteResult] = await connection.query("DELETE FROM notifications WHERE creator_id = ?", [creatorId]);
        console.log(`Deleted ${notificationsDeleteResult.affectedRows} rows from notifications`);
        const [itemsDeleteResult] = await connection.query("DELETE FROM items WHERE creator_id = ?", [creatorId]);
        console.log(`Deleted ${itemsDeleteResult.affectedRows} rows from items`);
        const [deleteResult] = await connection.query(
            "DELETE FROM creators WHERE id = ?",
            [creatorId]
        );
        console.log(`Deleted ${deleteResult.affectedRows} rows from creators`);
        if (deleteResult.affectedRows === 0) {
            await connection.rollback();
            console.log("Creator not found, rollback transaction");
            return res.status(404).json({ success: false, message: "Creator not found." });
        }
        await connection.commit();
        console.log("Transaction committed successfully");
        res.status(200).json({ success: true, message: 'Creator and all related data deleted successfully.' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error(`Error deleting creator ${creatorId}:`, err);
        res.status(500).json({ success: false, error: 'Database error or unexpected error.', details: err.message, stack: err.stack });
    } finally {
        if (connection) connection.release();
    }
});

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
            "UPDATE creators SET tokens = tokens + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
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
                type: "coins_added",
                amount: coinsToAdd.toString(),
                newBalance: newTotalCoins.toString()
            };

            try {
                await sendNotification(fcmToken, title, body, data);
                console.log(`Notification sent for added coins to creator ID: ${creatorId}`);

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
    const { tokens } = req.body;

    if (typeof tokens !== 'number' || tokens <= 0) {
        return res.status(400).json({ success: false, message: "Invalid token amount provided." });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const [updateResult] = await connection.query(
            "UPDATE creators SET tokens = tokens + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [tokens, creatorId]
        );

        if (updateResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Creator not found." });
        }

        const [creatorInfoRows] = await connection.query(
            "SELECT fcm_token, business_name, tokens FROM creators WHERE id = ?",
            [creatorId]
        );

        if (creatorInfoRows.length > 0 && creatorInfoRows[0].fcm_token) {
            const fcmToken = creatorInfoRows[0].fcm_token;
            const businessName = creatorInfoRows[0].business_name || 'Creator';
            const currentTokens = creatorInfoRows[0].tokens;

            const title = "Tokens Added! 💰";
            const body = `Hello ${businessName}, ${tokens} tokens have been successfully added to your account! Your new balance is ${currentTokens} tokens.`;
            const data = {
                creatorId: creatorId.toString(),
                addedTokens: tokens.toString(),
                newBalance: currentTokens.toString(),
                type: "tokens_added"
            };

            await sendNotification(fcmToken, title, body, data);

            await connection.query(
                `INSERT INTO notifications (creator_id, title, body, data, type) VALUES (?, ?, ?, ?, ?)`,
                [creatorId, title, body, JSON.stringify(data), 'tokens_recharge']
            );
        }

        await connection.commit();
        res.status(200).json({ success: true, message: `Tokens added successfully to creator ${creatorId} and notification sent.` });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error adding tokens:', err);
        res.status(500).json({ success: false, error: 'Database error or notification error.', details: err.message });
    } finally {
        if (connection) connection.release();
    }
});


// Advertisement Management Routes
/**
 * @route GET /api/owner/advertisements
 * @desc Get all advertisements (active and inactive)
 * @access Owner
 */
router.get('/advertisements', async (req, res) => {
    try {
        const [rows] = await (await db).execute('SELECT * FROM Advertisements ORDER BY created_at DESC');
        res.json({ success: true, advertisements: rows });
    } catch (error) {
        console.error('Error fetching all advertisements:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch all advertisements.' });
    }
});

/**
 * @route GET /api/owner/advertisements/active
 * @desc Get only active advertisements (for Owner management)
 * @access Owner
 */
router.get('/advertisements/active', async (req, res) => {
    try {
        const [rows] = await (await db).execute('SELECT * FROM Advertisements WHERE is_active = TRUE ORDER BY created_at DESC');
        res.json({ success: true, advertisements: rows });
    } catch (error) {
        console.error('Error fetching active advertisements (Owner):', error);
        res.status(500).json({ success: false, message: 'Failed to fetch active advertisements.' });
    }
});

/**
 * @route POST /api/owner/advertisements
 * @desc Add a new advertisement
 * @access Owner
 */
router.post('/advertisements', async (req, res) => {
    const { imageUrl, redirectUrl, startDate, endDate, isActive } = req.body;

    if (!imageUrl || !startDate || !endDate) {
        return res.status(400).json({ success: false, message: 'Image URL, start date, and end date are required.' });
    }

    try {
        const [result] = await (await db).execute(
            'INSERT INTO Advertisements (image_url, redirect_url, start_date, end_date, is_active) VALUES (?, ?, ?, ?, ?)',
            [imageUrl, redirectUrl || null, startDate, endDate, isActive ?? true]
        );
        res.status(201).json({ success: true, message: 'Advertisement added successfully.', id: result.insertId });
    } catch (error) {
        console.error('Error adding advertisement:', error);
        res.status(500).json({ success: false, message: 'Failed to add advertisement.' });
    }
});

/**
 * @route PUT /api/owner/advertisements/:id
 * @desc Update an existing advertisement
 * @access Owner
 */
router.put('/advertisements/:id', async (req, res) => {
    const { id } = req.params;
    const { imageUrl, redirectUrl, startDate, endDate, isActive } = req.body;

    if (!id) {
        return res.status(400).json({ success: false, message: 'Advertisement ID is required.' });
    }

    try {
        const [result] = await (await db).execute(
            'UPDATE Advertisements SET image_url = ?, redirect_url = ?, start_date = ?, end_date = ?, is_active = ? WHERE id = ?',
            [imageUrl, redirectUrl || null, startDate, endDate, isActive, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Advertisement not found.' });
        }
        res.json({ success: true, message: 'Advertisement updated successfully.' });
    } catch (error) {
        console.error('Error updating advertisement:', error);
        res.status(500).json({ success: false, message: 'Failed to update advertisement.' });
    }
});

/**
 * @route DELETE /api/owner/advertisements/:id
 * @desc Delete an advertisement
 * @access Owner
 */
router.delete('/advertisements/:id', async (req, res) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ success: false, message: 'Advertisement ID is required.' });
    }

    try {
        const [result] = await (await db).execute('DELETE FROM Advertisements WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Advertisement not found.' });
        }
        res.json({ success: true, message: 'Advertisement deleted successfully.' });
    } catch (error) {
        console.error('Error deleting advertisement:', error);
        res.status(500).json({ success: false, message: 'Failed to delete advertisement.' });
    }
});


router.get('/withdrawal-requests', async (req, res) => {
    try {
        const [rows] = await (await db).execute(`
            SELECT
                wr.id,
                wr.creator_id,
                c.first_name AS creator_first_name,
                c.last_name AS creator_last_name,
                c.store_name AS creator_business_name,
                c.phone AS creator_phone,
                wr.amount,
                wr.status,
                wr.request_date,
                wr.owner_notes,
                wr.processed_by,
                o.email AS processed_by_email,
                wr.processed_date
            FROM
                TokenRequests wr
            JOIN
                creators c ON wr.creator_id = c.id
            LEFT JOIN
                owners o ON wr.processed_by = o.id
            ORDER BY
                wr.request_date DESC
        `);
        res.json({ success: true, requests: rows });
    } catch (error) {
        console.error('Error fetching withdrawal requests:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch withdrawal requests.' });
    }
});


// New Routes for Sending Custom Notifications
/**
 * @route POST /api/owner/send-notification/creator/:creatorId
 * @desc Send a custom notification to a specific creator
 * @access Owner
 */
router.post('/send-notification/creator/:creatorId', async (req, res) => {
    const { creatorId } = req.params;
    const { title, body, data, orderId } = req.body;

    if (!title || !body) {
        return res.status(400).json({ success: false, message: 'Title and body are required for the notification.' });
    }

    try {
        // تأكد أن sendNotificationToCreator معرفة ومتاحة
        const notificationResult = await sendNotificationToCreator(parseInt(creatorId), title, body, data, orderId);
        if (notificationResult.success) {
            res.status(200).json({ success: true, message: 'Notification sent and saved successfully.', details: notificationResult.message });
        } else {
            res.status(500).json({ success: false, message: 'Failed to send or save notification.', details: notificationResult.message });
        }
    } catch (error) {
        console.error('Error sending custom notification to creator:', error);
        res.status(500).json({ success: false, message: 'Internal server error.', details: error.message });
    }
});

/**
 * @route POST /api/owner/send-notification/user/:userId
 * @desc Send a custom notification to a specific user
 * @access Owner
 */
router.post('/send-notification/user/:userId', async (req, res) => {
    const { userId } = req.params;
    const { title, body, data, orderId } = req.body;

    if (!title || !body) {
        return res.status(400).json({ success: false, message: 'Title and body are required for the notification.' });
    }

    try {
        // تأكد أن sendNotificationToUser معرفة ومتاحة
        const notificationResult = await sendNotificationToUser(parseInt(userId), title, body, data, orderId);
        if (notificationResult.success) {
            res.status(200).json({ success: true, message: 'Notification sent and saved successfully.', details: notificationResult.message });
        } else {
            res.status(500).json({ success: false, message: 'Failed to send or save notification.', details: notificationResult.message });
        }
    } catch (error) {
        console.error('Error sending custom notification to user:', error);
        res.status(500).json({ success: false, message: 'Internal server error.', details: error.message });
    }
});


// Help Requests Routes
router.get('/help-requests', async (req, res) => { // غيرت المسار إلى /help-requests ليكون أوضح
    try {
        const [rows] = await (await db).execute(`
            SELECT hr.id, hr.message, hr.status, hr.response_message, hr.created_at, u.username as user_username, u.email as user_email
            FROM HelpRequests hr
            JOIN Users u ON hr.user_id = u.id
            ORDER BY hr.created_at DESC
        `);
        res.status(200).json({ success: true, requests: rows });
    } catch (error) {
        console.error('Error fetching owner help requests:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch help requests.' });
    }
});

router.put('/help-requests/:id/respond', async (req, res) => { // غيرت المسار إلى /help-requests/:id/respond
    const requestId = req.params.id;
    const { responseMessage } = req.body;

    if (!responseMessage) {
        return res.status(400).json({ success: false, message: 'Response message is required.' });
    }

    try {
        const [result] = await (await db).execute(
            'UPDATE HelpRequests SET response_message = ?, status = "responded" WHERE id = ?',
            [responseMessage, requestId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Help request not found.' });
        }

        const [request] = await (await db).execute('SELECT user_id FROM HelpRequests WHERE id = ?', [requestId]);
        if (request.length > 0) {
            const userIdToNotify = request[0].user_id;
            // يمكنك هنا استدعاء sendNotificationToUser لإرسال إشعار للمستخدم
            console.log(`Notification to be sent to user ${userIdToNotify} for request ${requestId}`);
            // await sendNotificationToUser(userIdToNotify, "Your Help Request Update", "Your help request has been responded to.", { requestId: requestId.toString() }, null);
        }

        res.status(200).json({ success: true, message: 'Help request responded successfully!' });
    } catch (error) {
        console.error('Error responding to help request:', error);
        res.status(500).json({ success: false, message: 'Failed to respond to help request.' });
    }
});


module.exports = router;