// availabilityController.js
const db = require('../config/db');

exports.getAvailability = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT * FROM creator_availability 
      WHERE creator_id = ?
    `, [req.params.creator_id]);

    res.json(rows[0] || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.upsertAvailability = async (req, res) => {
  const { type, open_at, close_at, days } = req.body;
  const creatorId = req.params.creator_id;

  try {
    const [result] = await db.query(`
      INSERT INTO creator_availability 
        (creator_id, type, open_at, close_at, days)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        type = VALUES(type),
        open_at = VALUES(open_at),
        close_at = VALUES(close_at),
        days = VALUES(days)
    `, [creatorId, type, open_at, close_at, JSON.stringify(days)]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
