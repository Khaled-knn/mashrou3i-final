const db = require("../config/db");

const AddressController = {
  async upsertAddress(req, res) {
    const { creator_id, street, city, country } = req.body;

    // تحقق من وجود الحقول المطلوبة
    const missingFields = [];
    if (!creator_id) missingFields.push('creator_id');
    if (!street) missingFields.push('street');
    if (!city) missingFields.push('city');
    if (!country) missingFields.push('country');

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
        missingFields
      });
    }

    try {
      // استعمل UPSERT (INSERT ... ON DUPLICATE KEY UPDATE)
      const [result] = await db.query(`
        INSERT INTO addresses (creator_id, street, city, country)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          street = VALUES(street),
          city = VALUES(city),
          country = VALUES(country)
      `, [creator_id, street, city, country]);

      // result.affectedRows:
      // 1 يعني إدخال جديد
      // 2 يعني تحديث (لأن MySQL يحسب الصفين: حذف+إدخال)
      const isInsert = result.affectedRows === 1;
      const message = isInsert ? 'Address created successfully' : 'Address updated successfully';
      const statusCode = isInsert ? 201 : 200;

      return res.status(statusCode).json({
        success: true,
        message,
        data: {
          creator_id,
          street,
          city,
          country
        }
      });
    } catch (err) {
      console.error('Error in upsertAddress:', err);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        details: err.message
      });
    }
  },

  async getAddress(req, res) {
    const { creator_id } = req.params;

    if (!creator_id) {
      return res.status(400).json({
        success: false,
        error: "Creator ID is required"
      });
    }

    try {
      const [rows] = await db.query(
        "SELECT creator_id, street, city, country FROM addresses WHERE creator_id = ?",
        [creator_id]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Address not found for this creator"
        });
      }

      return res.status(200).json({
        success: true,
        data: rows[0]
      });
    } catch (err) {
      console.error('Error in getAddress:', err);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        details: err.message
      });
    }
  }
};

module.exports = AddressController;
