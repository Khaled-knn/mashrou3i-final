const db = require('../config/db');

// Get all offers for a specific creator
exports.getOffer = async (req, res) => {
  const creatorId = req.params.creator_id;
  try {
    const [rows] = await db.query(
      `SELECT offer_type, offer_value, offer_start, offer_end
       FROM creator_offers
       WHERE creator_id = ?`,
      [creatorId]
    );

    res.json(rows); // حتى لو كانت فارغة، نرجع مصفوفة فارغة بدلاً من خطأ 404
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Add or update offers for a creator
exports.upsertOffer = async (req, res) => {
  const creatorId = req.params.creator_id;
  const offers = req.body;

  if (!Array.isArray(offers)) {
    return res.status(400).json({ 
      error: 'Expected an array of offers',
      received: typeof offers
    });
  }

  try {
    await db.query(
      'DELETE FROM creator_offers WHERE creator_id = ?',
      [creatorId]
    );

    // إضافة العروض الجديدة
    for (const offer of offers) {
      const { offer_type, offer_value, offer_start, offer_end } = offer;
      
      await db.query(
        `INSERT INTO creator_offers 
         (creator_id, offer_type, offer_value, offer_start, offer_end)
         VALUES (?, ?, ?, ?, ?)`,
        [creatorId, offer_type, offer_value, offer_start, offer_end]
      );
    }

    res.json({ 
      success: true,
      message: `${offers.length} offers updated successfully`
    });
  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      details: error
    });
  }
};