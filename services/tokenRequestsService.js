
const db = require('../config/db'); 



const TokenRequestsService = {
    async createRequestAndNotifyOwner(creatorId, amount) {
        let connection;
        try {
            connection = await db.getConnection(); 

            const [creatorRows] = await connection.execute(
                'SELECT first_name, last_name, email FROM creators WHERE id = ?',
                [creatorId]
            );

            if (creatorRows.length === 0) {
                throw new Error('Creator not found.');
            }
            const creatorData = creatorRows[0];
            const creatorName = `${creatorData.first_name} ${creatorData.last_name}`.trim();
            const creatorEmail = creatorData.email; // ممكن تحتاج إيميل الكريتور لاحقاً

            // 2. حفظ الطلب في جدول TokenRequests
            const [result] = await connection.execute(
                'INSERT INTO TokenRequests (creator_id, amount, status, request_date) VALUES (?, ?, ?, NOW())',
                [creatorId, amount, 'Pending']
            );
            const requestId = result.insertId;


            return requestId; // إرجاع ID الطلب الجديد

        } catch (error) {
            console.error('Error in TokenRequestsService:', error);
            // بما أننا ركزنا على DB، إذا كان الخطأ من الـ DB، رح يظهر هنا.
            // يمكنك تخصيص رسالة الخطأ إذا كان نوع الخطأ من الـ DB.
            throw error; // إعادة رمي الخطأ ليتم التعامل معه في الـ Controller
        } finally {
            if (connection) connection.release(); // إعادة الاتصال لـ pool
        }
    }
};

module.exports = TokenRequestsService;