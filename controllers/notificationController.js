const db = require('../config/db');
const parseNotificationData = (notification) => {
    let parsedData = {};
    if (notification.data) {
        try {
            parsedData = JSON.parse(notification.data);
        } catch (e) {
            console.error("Error parsing notification data JSON:", e, notification.data);
            parsedData = { rawData: notification.data };
        }
    }
    return {
        id: notification.id,
        userId: notification.user_id,
        creatorId: notification.creator_id,
        orderId: notification.order_id,
        title: notification.title,
        body: notification.body,
        isRead: notification.is_read === 1, // تحويل من TinyInt (0/1) إلى Boolean
        createdAt: notification.created_at,
        data: parsedData, // البيانات الإضافية ككائن
    };
};

exports.getUserNotifications = async (req, res) => {
    // نحصل على ID المستخدم من التوكن (req.user)
    const userId = req.user.id; 
    let connection;

    try {
        connection = await db.getConnection(); // الحصول على اتصال من Pool قاعدة البيانات
        
        // جلب الإشعارات الخاصة بهذا المستخدم
        const [notifications] = await connection.query(
            `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC`,
            [userId]
        );

        // تحليل بيانات الإشعارات (JSON fields)
        const parsedNotifications = notifications.map(parseNotificationData);

        connection.release(); // تحرير الاتصال بقاعدة البيانات

        res.status(200).json({
            success: true,
            notifications: parsedNotifications,
        });

    } catch (err) {
        if (connection) connection.release();
        console.error("Error fetching user notifications:", err);
        res.status(500).json({
            success: false,
            message: "An internal server error occurred while fetching user notifications.",
            error: err.message
        });
    }
};

exports.getCreatorNotifications = async (req, res) => {
    // نحصل على ID الكريتور من التوكن (req.user)
    const creatorId = req.user.id; 
    let connection;

    try {
        connection = await db.getConnection();

        // جلب الإشعارات الخاصة بهذا الكريتور
        // قد تحتاج إلى تعديل هذا الاستعلام بناءً على كيفية تخزينك لإشعارات الكريتور.
        // إذا كانت الإشعارات في نفس جدول 'notifications' ولديهم 'creator_id' مباشر:
        const [notifications] = await connection.query(
            `SELECT * FROM notifications WHERE creator_id = ? ORDER BY created_at DESC`,
            [creatorId]
        );
        // إذا كانت إشعارات الكريتور مرتبطة بـ 'orders' التي قاموا بإنشائها:
        /*
        const [notifications] = await connection.query(
            `SELECT n.* FROM notifications n
             JOIN orders o ON n.order_id = o.id
             WHERE o.creator_id = ? ORDER BY n.created_at DESC`,
            [creatorId]
        );
        */

        const parsedNotifications = notifications.map(parseNotificationData);

        connection.release();

        res.status(200).json({
            success: true,
            notifications: parsedNotifications,
        });

    } catch (err) {
        if (connection) connection.release();
        console.error("Error fetching creator notifications:", err);
        res.status(500).json({
            success: false,
            message: "An internal server error occurred while fetching creator notifications.",
            error: err.message
        });
    }
};

exports.markNotificationAsRead = async (req, res) => {
    const { notificationId } = req.params;
    // نحصل على ID المستخدم/الكريتور من التوكن للتحقق من الصلاحية
    const userId = req.user.id; 
    let connection;

    try {
        connection = await db.getConnection();
        
        // تحديث حالة الإشعار إلى مقروء
        // تأكد من أن الإشعار يخص المستخدم/الكريتور الذي يحاول تحديثه
        const [result] = await connection.query(
            `UPDATE notifications SET is_read = 1 WHERE id = ? AND (user_id = ? OR creator_id = ?)`,
            [notificationId, userId, userId] // يتيح للمستخدم أو الكريتور تحديث إشعاراته
        );

        connection.release();

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "Notification not found or you don't have permission to update it." });
        }

        res.status(200).json({ success: true, message: "Notification marked as read." });

    } catch (err) {
        if (connection) connection.release();
        console.error("Error marking notification as read:", err);
        res.status(500).json({
            success: false,
            message: "An internal server error occurred while marking notification as read.",
            error: err.message
        });
    }
};

exports.deleteNotification = async (req, res) => {
    const { notificationId } = req.params;
    const userId = req.user.id; // المستخدم أو الكريتور الذي يحاول الحذف
    let connection;

    try {
        connection = await db.getConnection();
        const [result] = await connection.query(
            `DELETE FROM notifications WHERE id = ? AND (user_id = ? OR creator_id = ?)`,
            [notificationId, userId, userId]
        );
        connection.release();

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "Notification not found or you don't have permission to delete it." });
        }

        res.status(200).json({ success: true, message: "Notification deleted successfully." });

    } catch (err) {
        if (connection) connection.release();
        console.error("Error deleting notification:", err);
        res.status(500).json({ success: false, message: "An internal server error occurred while deleting the notification." });
    }
};