const db = require('../config/db'); // استيراد الـ Connection Pool

class Item {
    constructor(id, creator_id, profession_id, name, price, pictures, description, time, working_time, course_duration, ingredients, behance_link, portfolio_links, drive_link, additional_data, is_featured) {
      this.id = id;
      this.creator_id = creator_id;
      this.profession_id = profession_id;
      this.name = name;
      this.price = price;
      this.pictures = pictures;
      this.description = description;
      this.time = time;
      this.working_time = working_time;
      this.course_duration = course_duration;
      this.ingredients = ingredients;
      this.behance_link = behance_link;
      this.portfolio_links = portfolio_links;
      this.drive_link = drive_link;
      this.additional_data = additional_data;
      this.is_featured = is_featured; // الحقل الجديد
    }
  
  static async create(itemData) {
    const { creator_id, profession_id, name, price, pictures, description, time, working_time, course_duration, ingredients, behance_link, portfolio_links, drive_link, additional_data, is_featured = false } = itemData;      const [result] = await db.execute(
        'INSERT INTO items (creator_id, profession_id, name, price, pictures, description, time, working_time, course_duration, ingredients, behance_link, portfolio_links, drive_link, additional_data, is_featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [creator_id, profession_id, name, price, JSON.stringify(pictures), description, time, working_time, course_duration, JSON.stringify(ingredients), behanceLink, JSON.stringify(portfolio_links), drive_link, JSON.stringify(additional_data), is_featured]
      );
      return result.insertId;
    }
  
    static async findByCreatorId(creatorId) {
      const [rows] = await db.execute('SELECT * FROM items WHERE creator_id = ?', [creatorId]);
      return rows.map(row => new Item(row.id, row.creator_id, row.profession_id, row.name, row.price, JSON.parse(row.pictures), row.description, row.time, row.working_time, row.course_duration, JSON.parse(row.ingredients), row.behance_link, JSON.parse(row.portfolio_links), row.drive_link, JSON.parse(row.additional_data), row.is_featured));
    }
  
  }
module.exports = Item;