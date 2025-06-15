const db = require('../config/db');
exports.updateFcmToken = async (req, res) => {

    const { id, type, fcmToken } = req.body;

    if (!id || !type || !fcmToken) {
        return res.status(400).json({ success: false, message: "Missing required fields: id, type, or fcmToken." });
    }

    let tableName;
    if (type === 'user') {
        tableName = 'users';
    } else if (type === 'creator') {
        // هذه الحالة للـ Creators، رح نعالجها لاحقاً
        tableName = 'creators';
    } else {
        return res.status(400).json({ success: false, message: "Invalid user type. Must be 'user' or 'creator'." });
    }

    try {
        // تنفيذ استعلام التحديث في قاعدة البيانات
        const [result] = await db.query(
            `UPDATE ${tableName} SET fcm_token = ? WHERE id = ?`,
            [fcmToken, id]
        );

        // التحقق مما إذا كان التحديث قد تم بنجاح
        if (result.affectedRows > 0) {
            console.log(`✅ FCM Token updated for ${type} ID: ${id}`);
            res.status(200).json({ success: true, message: `FCM Token updated successfully for ${type} ID: ${id}.` });
        } else {
            // إذا لم يتم العثور على الصف لتحديثه
            console.warn(`⚠️ ${type} with ID ${id} not found to update FCM token.`);
            res.status(404).json({ success: false, message: `${type} with ID ${id} not found to update FCM token.` });
        }
    } catch (error) {
        // معالجة الأخطاء في حال حدوثها أثناء الاتصال بقاعدة البيانات
        console.error(`❌ Error updating FCM token for ${type} ID ${id}:`, error);
        res.status(500).json({ success: false, message: "An internal server error occurred while updating FCM token.", error: error.message });
    }
};