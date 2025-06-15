const db = require('../config/db');

class Category {
  constructor(id, name, description) {
    this.id = id;
    this.name = name;
    this.description = description;
  }

  static async create(categoryData) {
    const { name, description } = categoryData;
    const [result] = await db.execute('INSERT INTO categories (name, description) VALUES (?, ?)', [name, description]);
    return result.insertId;
  }

  static async findAll() {
    const [rows] = await db.execute('SELECT * FROM categories');
    return rows.map(row => new Category(row.id, row.name, row.description));
  }

  static async findById(id) {
    const [rows] = await db.execute('SELECT * FROM categories WHERE id = ?', [id]);
    if (rows.length > 0) {
      return new Category(rows[0].id, rows[0].name, rows[0].description);
    }
    return null;
  }
}

module.exports = Category;