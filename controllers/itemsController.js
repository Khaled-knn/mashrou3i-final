const ItemsService = require('../services/itemsService');

const validateUpdateData = (data) => {
  const errors = [];
  // You might want to make these checks more robust based on profession_id
  if (!data.name || data.name.trim() === '') errors.push('Name is required');
  if (data.price === null || data.price === undefined || isNaN(data.price)) errors.push('Price is required and must be a number');
  return errors;
};

const itemsController = {
  async getItems(req, res) {
    try {
      // req.userId أو req.user.id؟ تأكد من الكائن الذي يحمل الـ ID
      // بناءً على الكود اللي أرسلته سابقاً، يبدو أنك تستخدم req.user.id في additem
      const items = await ItemsService.fetchUserItems(req.user.id);
      res.status(200).json({ items });
    } catch (error) {
      console.error('Error in getItems:', error);
      res.status(500).json({ error: 'Failed to fetch items', details: error.message });
    }
  },

  async deleteItem(req, res) {
    try {
      // هنا req.user.id هو الأصح حسب الأمثلة السابقة
      await ItemsService.deleteItem(req.params.id, req.user.id); 
      res.status(200).json({ message: 'Item deleted successfully' });
    } catch (error) {
      console.error('Error in deleteItem:', error);
      const status = error.message.includes('not found') || error.message.includes('unauthorized') ? 404 : 500;
      res.status(status).json({ error: error.message });
    }
  },

  async updateItem(req, res) {
    try {
      const errors = validateUpdateData(req.body);
      if (errors.length > 0) {
        return res.status(400).json({ errors });
      }

      const result = await ItemsService.updateItem(
        req.params.id,
        req.user.id, // هنا أيضاً req.user.id
        req.body
      );
      res.status(200).json(result);
    } catch (error) {
      console.error('Error in updateItem:', error);
      let status = 500;
      let errorMessage = 'Failed to update item';

      if (error.message.includes('Item not found') || error.message.includes('unauthorized')) {
        status = 404;
        errorMessage = 'Item not found or you are not authorized to update it.';
      } else if (error.message.includes('Cannot edit')) {
        status = 403;
        errorMessage = 'Cannot edit item. It has been more than 24 hours since creation.';
      } else if (error.message.includes('Insufficient tokens')) {
        status = 403;
        errorMessage = error.message; // رسالة الخطأ من الخدمة مباشرة
      }
      res.status(status).json({ error: errorMessage });
    }
  }
};

module.exports = itemsController;