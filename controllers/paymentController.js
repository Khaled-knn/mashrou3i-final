const db = require('../config/db');

// Get all payment methods for a creator
exports.getPaymentMethods = async (req, res) => {
  const creatorId = req.params.creator_id;
  try {
    const [rows] = await db.query(`
      SELECT method, account_info 
      FROM creator_payment_methods
      WHERE creator_id = ?
    `, [creatorId]);

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Add or update payment methods for a creator (overwrite all)
exports.upsertPaymentMethods = async (req, res) => {
  const creatorId = req.params.creator_id;
  const methods = req.body.methods; // array of { method: 'omt', account_info: '...' }

  if (!Array.isArray(methods)) {
    return res.status(400).json({ error: "methods must be an array" });
  }

  try {
    // حذف الطرق القديمة
    await db.query(`DELETE FROM creator_payment_methods WHERE creator_id = ?`, [creatorId]);

    // إضافة الطرق الجديدة
    for (const method of methods) {
      await db.query(`
        INSERT INTO creator_payment_methods (creator_id, method, account_info)
        VALUES (?, ?, ?)
      `, [creatorId, method.method, method.account_info || null]);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
