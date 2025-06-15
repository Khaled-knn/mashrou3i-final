// controllers/itemController.js

const db = require('../config/db');

const fetchMyItems = async (req, res) => {
    try {
        const creatorId = req.user.id;

        const [basicItems] = await db.execute(
            'SELECT * FROM items WHERE creator_id = ?',
            [creatorId]
        );

        if (basicItems.length === 0) {
            return res.status(200).json({ items: [] });
        }

        const detailedItems = await Promise.all(
            basicItems.map(async (item) => {
                let details = {};

                switch (item.profession_id) {
                    case 1: // Food Chef
                    case 2: // Sweet Chef
                        [details] = await db.execute(
                            'SELECT time, ingredients FROM restaurant_item_details WHERE item_id = ?',
                            [item.id]
                        );
                        break;
                    case 3: // Home Services
                        [details] = await db.execute(
                            'SELECT working_time, behance_link, portfolio_links FROM hs_item_details WHERE item_id = ?',
                            [item.id]
                        );
                        break;
                    case 4: // Hand Crafter
                        [details] = await db.execute(
                            'SELECT time, ingredients, additional_data FROM hc_item_details WHERE item_id = ?',
                            [item.id]
                        );
                        break;
                    case 5: // Freelancer's
                        [details] = await db.execute(
                            'SELECT working_time, portfolio_links FROM freelancer_item_details WHERE item_id = ?',
                            [item.id]
                        );
                        break;
                    case 6: // Tutoring
                        // **التعديل هنا: أضف google_drive_link إلى SELECT statement**
                        [details] = await db.execute(
                            'SELECT course_duration, syllabus, google_drive_link FROM tutoring_item_details WHERE item_id = ?',
                            [item.id]
                        );
                        break;
                    default:
                        console.warn(`Unknown profession_id: ${item.profession_id} for item ${item.id}`);
                        details = [];
                        break;
                }

                const itemDetails = details[0] || null;

                if (itemDetails?.ingredients && (item.profession_id === 1 || item.profession_id === 2 || item.profession_id === 4)) {
                    try {
                        itemDetails.ingredients = JSON.parse(itemDetails.ingredients);
                    } catch (e) {
                        console.error(`Failed to parse ingredients for item ${item.id}:`, e);
                    }
                }

                if (itemDetails?.portfolio_links && (item.profession_id === 3 || item.profession_id === 5)) {
                    try {
                        itemDetails.portfolio_links = JSON.parse(itemDetails.portfolio_links);
                    } catch (e) {
                        console.error(`Failed to parse portfolio_links for item ${item.id}:`, e);
                    }
                }

                // **لا يوجد JSON.parse لـ google_drive_link لأنه VARCHAR وليس JSON**
                // إذا كنت قد حفظته كـ JSON Stringify بالخطأ، ستحتاج لـ parse
                // ولكن بما أنك حددته VARCHAR(255) NULL، فما رح تحتاج parse.
                // itemDetails?.google_drive_link إذا كان موجوداً، سيُرسل مباشرة.

                if (item.pictures) {
                    try {
                        item.pictures = JSON.parse(item.pictures);
                    } catch (e) {
                        console.error(`Failed to parse pictures for item ${item.id}:`, e);
                    }
                }

                return {
                    ...item,
                    details: itemDetails,
                };
            })
        );

        res.status(200).json({ items: detailedItems });
    } catch (error) {
        console.error('Error fetching items:', error);
        res.status(500).json({ error: 'خطأ أثناء جلب العناصر' });
    }
};

module.exports = { fetchMyItems };