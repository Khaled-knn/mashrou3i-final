// controllers/itemController.js

const db = require('../config/db');

const addItem = async (req, res) => {
    try {
        const creatorId = req.user.id;

        const {
            name,
            price,
            pictures = [],
            description = null,

            time = null,
            ingredients = [],
            additional_data = null,

            course_duration = null,
            syllabus = null,
            // **التعديل الأول: أضف google_drive_link هنا لاستقباله من الـ request body**
            google_drive_link = null, // هذا هو الحقل الجديد لـ Tutoring

            working_time = null,
            behance_link = null, // هذا يبدو أنه لـ HS
            portfolio_links = [],
        } = req.body;

        if (!name || price === null || price === undefined) {
            return res.status(400).json({ error: 'Name and price are required fields' });
        }

        const [creatorRows] = await db.execute(
            'SELECT profession_id, tokens FROM creators WHERE id = ?',
            [creatorId]
        );

        if (creatorRows.length === 0) {
            return res.status(404).json({ error: 'Creator not found' });
        }

        const creator = creatorRows[0];
        const actualCategoryId = creator.profession_id;

        const currentTokens = parseFloat(creator.tokens);
        if (isNaN(currentTokens)) {
            console.error(`Invalid tokens value for creator ${creatorId}: ${creator.tokens}`);
            return res.status(500).json({ error: 'Invalid tokens value retrieved from database' });
        }

        console.log(`Current tokens for creator ${creatorId}: ${currentTokens}`);

        if (currentTokens < 5) {
            return res.status(400).json({
                error: 'Insufficient tokens to add item',
                required: 5,
                available: currentTokens
            });
        }

        const itemPictures = pictures.length > 0 ? JSON.stringify(pictures) : null;
        const itemIngredients = ingredients.length > 0 ? JSON.stringify(ingredients) : null;
        const itemPortfolioLinks = portfolio_links.length > 0 ? JSON.stringify(portfolio_links) : null;

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            const [itemResult] = await connection.execute(
                'INSERT INTO items (creator_id, category_id, name, price, pictures, description, profession_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [creatorId, actualCategoryId, name, price, itemPictures, description, creator.profession_id]
            );
            const itemId = itemResult.insertId;

            if ([1, 2].includes(creator.profession_id)) {
                await connection.execute(
                    'INSERT INTO restaurant_item_details (item_id, time, ingredients) VALUES (?, ?, ?)',
                    [itemId, time, itemIngredients]
                );
            } else if (creator.profession_id === 3) {
                // ملاحظة: behance_link و portfolio_links موجودين هنا، تأكد من أن هذا صحيح لـ HS
                await connection.execute(
                    'INSERT INTO hs_item_details (item_id, working_time, behance_link, portfolio_links) VALUES (?, ?, ?, ?)',
                    [itemId, working_time, behance_link, itemPortfolioLinks]
                );
            } else if (creator.profession_id === 4) { // Hand Crafter
                await connection.execute(
                    'INSERT INTO hc_item_details (item_id, time, ingredients, additional_data) VALUES (?, ?, ?, ?)',
                    [itemId, time, itemIngredients, additional_data]
                );
            } else if (creator.profession_id === 5) { // Freelancer's
                await connection.execute(
                    'INSERT INTO freelancer_item_details (item_id, working_time, portfolio_links) VALUES (?, ?, ?)',
                    [itemId, working_time, itemPortfolioLinks]
                );
            } else if (creator.profession_id === 6) { // Tutoring
                // **التعديل الثاني: أضف google_drive_link إلى الـ INSERT statement والقيم**
                await connection.execute(
                    'INSERT INTO tutoring_item_details (item_id, course_duration, syllabus, google_drive_link) VALUES (?, ?, ?, ?)',
                    [itemId, course_duration, syllabus, google_drive_link] // أضف google_drive_link هنا
                );
            }

            await connection.execute(
                'UPDATE creators SET tokens = tokens - 5, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [creatorId]
            );
            console.log(`Deducted 5 tokens from creator ${creatorId} for adding item ${itemId}.`);

            await connection.commit();
            connection.release();

            res.status(201).json({
                success: true,
                message: 'Item added successfully',
                itemId,
                remainingTokens: currentTokens - 5
            });

        } catch (transactionError) {
            if (connection) {
                await connection.rollback();
                connection.release();
            }
            console.error('Error in addItem transaction:', transactionError);
            throw transactionError; // أعد رمي الخطأ للـ catch الخارجي
        }

    } catch (error) {
        console.error('Error adding item:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};



const searchItems = async (req, res) => {
  try {
    const {
      query,
      professionId,
      minRate,
      limit = 20,
      offset = 0,
      time,
      working_time,
      course_duration,
    } = req.query;

    let globalWhereParts = [];
    let globalQueryParams = [];

    if (query) {
      globalWhereParts.push(
        `(LOWER(i.name) LIKE LOWER(?) OR LOWER(CONCAT(c.first_name, ' ', c.last_name)) LIKE LOWER(?))`
      );
      globalQueryParams.push(`%${query}%`, `%${query}%`);
    }

    if (minRate) {
      globalWhereParts.push(`c.rate >= ?`);
      globalQueryParams.push(parseFloat(minRate));
    }

    let unionQueries = [];
    let allUnionQueryParams = [];

    const allDetailColumns = [
      "time",
      "ingredients",
      "additional_data",
      "working_time",
      "behance_link",
      "portfolio_links",
      "course_duration",
      "syllabus",
      "google_drive_link",
    ];

    const buildSingleProfessionQuery = (profIds, detailTable, detailAlias) => {
      let selectDetailsArray = [];
      let joinClause = "";
      let specificWhereParts = [];
      let specificQueryParams = [];

      if (detailTable) {
        joinClause = `LEFT JOIN ${detailTable} ${detailAlias} ON i.id = ${detailAlias}.item_id`;
      }

      const columnsFromDetailTable = [];
      if (profIds.includes(1) || profIds.includes(2)) {
        columnsFromDetailTable.push("time", "ingredients");
        if (time) {
          specificWhereParts.push(`${detailAlias}.time = ?`);
          specificQueryParams.push(time);
        }
      } else if (profIds.includes(4)) {
        columnsFromDetailTable.push("time", "ingredients", "additional_data");
        if (time) {
          specificWhereParts.push(`${detailAlias}.time = ?`);
          specificQueryParams.push(time);
        }
      } else if (profIds.includes(3)) {
        columnsFromDetailTable.push("working_time", "behance_link", "portfolio_links");
        if (working_time) {
          specificWhereParts.push(`${detailAlias}.working_time = ?`);
          specificQueryParams.push(working_time);
        }
      } else if (profIds.includes(5)) {
        columnsFromDetailTable.push("working_time", "portfolio_links");
        if (working_time) {
          specificWhereParts.push(`${detailAlias}.working_time = ?`);
          specificQueryParams.push(working_time);
        }
      } else if (profIds.includes(6)) {
        columnsFromDetailTable.push("course_duration", "syllabus", "google_drive_link");
        if (course_duration) {
          specificWhereParts.push(`${detailAlias}.course_duration = ?`);
          specificQueryParams.push(course_duration);
        }
      }

      for (const col of allDetailColumns) {
        if (columnsFromDetailTable.includes(col)) {
          selectDetailsArray.push(`${detailAlias}.${col}`);
        } else {
          selectDetailsArray.push(`NULL AS ${col}`);
        }
      }

      const selectDetails = selectDetailsArray.join(", ");
      let currentWhereParts = [...globalWhereParts];
      let currentQueryParams = [...globalQueryParams];

      if (profIds.length === 1) {
        currentWhereParts.push(`i.profession_id = ?`);
        currentQueryParams.push(profIds[0]);
      } else {
        currentWhereParts.push(`i.profession_id IN (${profIds.map(() => "?").join(", ")})`);
        currentQueryParams.push(...profIds);
      }

      if (specificWhereParts.length > 0) {
        currentWhereParts.push(...specificWhereParts);
      }

      allUnionQueryParams.push(...currentQueryParams, ...specificQueryParams);

      const whereClause = currentWhereParts.length > 0 ? `WHERE ${currentWhereParts.join(" AND ")}` : "";

      return `
      SELECT
          i.id, i.name, i.price, i.description, i.pictures, i.profession_id, i.creator_id,
          CONCAT(c.first_name, ' ', c.last_name) AS creator_name,
          c.rate AS rating,
          c.profile_image AS creator_image,
          c.phone AS creator_phone,
          c.store_name AS store_name,
          c.deliveryValue AS delivery_value,
          c.cover_photo AS cover_photo
          ${selectDetails ? ", " + selectDetails : ""}
      FROM items i
      JOIN creators c ON i.creator_id = c.id
      ${joinClause}
      ${whereClause}
    `;
    };

    const parsedProfessionId = professionId ? parseInt(professionId) : null;

    if (!parsedProfessionId || [1, 2].includes(parsedProfessionId)) {
      unionQueries.push(buildSingleProfessionQuery([1, 2], "restaurant_item_details", "rid"));
    }
    if (!parsedProfessionId || parsedProfessionId === 4) {
      unionQueries.push(buildSingleProfessionQuery([4], "hc_item_details", "hcd"));
    }
    if (!parsedProfessionId || parsedProfessionId === 3) {
      unionQueries.push(buildSingleProfessionQuery([3], "hs_item_details", "hsd"));
    }
    if (!parsedProfessionId || parsedProfessionId === 5) {
      unionQueries.push(buildSingleProfessionQuery([5], "freelancer_item_details", "fid"));
    }
    if (!parsedProfessionId || parsedProfessionId === 6) {
      unionQueries.push(buildSingleProfessionQuery([6], "tutoring_item_details", "tid"));
    }

    if (unionQueries.length === 0) {
      return res.status(200).json({ success: true, results: [], total: 0 });
    }

    let fullQuery = unionQueries.join(" UNION ALL ");
    fullQuery += ` ORDER BY creator_name ASC, name ASC LIMIT ? OFFSET ?;`;
    allUnionQueryParams.push(parseInt(limit), parseInt(offset));

    // تنفيذ الاستعلام الأساسي لجلب المنتجات مع منشئيها
    const [results] = await db.execute(fullQuery, allUnionQueryParams);

    if (results.length === 0) {
      return res.status(200).json({ success: true, results: [], total: 0 });
    }

    // جمع معرفات المنشئين من النتائج
    const creatorIds = [...new Set(results.map((item) => item.creator_id))];

    // جلب البيانات المكملة للمنشئين دفعة واحدة
    const [availability] = await db.query(
      "SELECT * FROM creator_availability WHERE creator_id IN (?)",
      [creatorIds]
    );
    const [offers] = await db.query(
      "SELECT * FROM creator_offers WHERE creator_id IN (?)",
      [creatorIds]
    );
    const [paymentMethods] = await db.query(
      "SELECT * FROM creator_payment_methods WHERE creator_id IN (?)",
      [creatorIds]
    );
    const [addresses] = await db.query(
      "SELECT creator_id, city, country, street FROM addresses WHERE creator_id IN (?)",
      [creatorIds]
    );
    const [rates] = await db.query(
      `SELECT creator_id, COUNT(*) AS rate_count, ROUND(AVG(rating), 2) AS average_rate
       FROM creator_reviews WHERE creator_id IN (?) GROUP BY creator_id`,
      [creatorIds]
    );

    // دوال مساعدة لجلب التقييمات
    const getRateCount = (cid) => rates.find((r) => r.creator_id === cid)?.rate_count || 0;
    const getAverageRate = (cid) => rates.find((r) => r.creator_id === cid)?.average_rate || 0;

    // دمج البيانات مع كل منتج
    results.forEach((item) => {
      const cid = item.creator_id;

      item.availability = availability
        .filter((a) => a.creator_id === cid)
        .map((a) => ({
          type: a.type,
          open_at: a.open_at,
          close_at: a.close_at,
          days: a.days ? JSON.parse(a.days) : null,
        }));

      item.offers = offers
        .filter((o) => o.creator_id === cid)
        .map((o) => ({
          type: o.offer_type,
          value: o.offer_value,
          start: o.offer_start,
          end: o.offer_end,
        }));

      item.payment_methods = paymentMethods
        .filter((p) => p.creator_id === cid)
        .map((p) => ({
          method: p.method,
          account_info: p.account_info,
        }));

      const address = addresses.find((addr) => addr.creator_id === cid);
      item.address = address
        ? {
            city: address.city,
            street: address.street,
            country: address.country,
          }
        : null;

      item.rate_count = getRateCount(cid);
      item.rating = getAverageRate(cid);
    });

    res.status(200).json({
      success: true,
      results,
      total: results.length,
    });
  } catch (error) {
    console.error("Error during search:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      details: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};



module.exports = { searchItems };


module.exports = {
    addItem, // إذا كانت addItem بنفس الملف
    searchItems,
};
