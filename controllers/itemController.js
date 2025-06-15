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
            query, // نص البحث
            professionId, // id المهنة المحدد للفلترة
            minRate, // الحد الأدنى للتقييم (إذا كان عندك تقييم للـ items أو للـ creators)
            freeDelivery, // للتوصيل المجاني (خاص بالمطاعم/المحلات)
            hasOffer, // إذا كان في عرض
            isOpenNow, // إذا المحل مفتوح حالياً
            limit = 10, // عدد النتائج في الصفحة الواحدة
            offset = 0, // الإزاحة (كم نتيجة تتخطاها)
            // أي فلاتر إضافية حسب الـ profession_id
            time, // وقت تحضير الوجبة (للمطاعم و Hand Crafter)
            working_time, // أوقات العمل (لـ HS و Freelancer)
            course_duration, // مدة الدورة (لـ Tutoring)
        } = req.query; // استخدم req.query لاستقبال الـ query parameters

        let sqlQueryParts = [];
        let queryParams = [];

        // الشرط الأساسي: البحث عن طريق اسم الـ item
        if (query) {
            // بحث عن أي جزء من الكلمة في الاسم
            // ممكن تحتاج تستخدم COLLATE عشان تتأكد إنو البحث غير حساس لحالة الأحرف (case-insensitive) بالعربي
            sqlQueryParts.push(`i.name LIKE ?`);
            queryParams.push(`%${query}%`);
        }

        // فلترة حسب الـ profession_id
        if (professionId) {
            // لازم تتأكد إنو professionId رقم صحيح
            const parsedProfessionId = parseInt(professionId);
            if (!isNaN(parsedProfessionId)) {
                sqlQueryParts.push(`i.profession_id = ?`);
                queryParams.push(parsedProfessionId);
            }
        }

        // بناء استعلام البحث الشامل
        // هذا الاستعلام رح يعمل JOIN بين جدول الـ items والجداول التفصيلية
        // ورح يستخدم LEFT JOIN عشان يرجع الـ items حتى لو ما كان إلها تفاصيل في كل الجداول
        // استخدام UNION ALL أفضل لما بتكون بتجمع نتائج من جداول مختلفة تماماً (مثلاً لو بتبحث عن مطاعم ومنتجات بشكل منفصل)
        // لكن بما إنو الـ items هي الأساس وتفاصيلها بتتوزع، ممكن نستخدم LEFT JOIN مع شروط WHERE
        // أو نكتب استعلامات منفصلة لكل نوع ونجمعها في الـ Node.js
        // الطريقة الثانية (استعلامات منفصلة ودمج في Node.js) بتكون أسهل للفلترة المعقدة

        let allResults = [];

        // ---- 1. بحث المطاعم (profession_id 1, 2) و Hand Crafter (profession_id 4)
        // بما أن restaurant_item_details و hc_item_details لهم نفس حقول time و ingredients
        if (!professionId || [1, 2, 4].includes(parseInt(professionId))) {
            let itemDetailsTable = '';
            let itemDetailsSelect = '';
            let itemDetailsWhere = [];

            // تحديد الجدول التفصيلي بناءً على الـ professionId المحدد
            // إذا لم يتم تحديد professionId، سنقوم بالبحث في كليهما أو افتراض الأكثر شيوعاً للمثال
            // للمثال: سنفصلهم ليكون أوضح
            if (!professionId || parseInt(professionId) === 1 || parseInt(professionId) === 2) { // Restaurants
                itemDetailsTable = 'restaurant_item_details';
                itemDetailsSelect = ', rid.time, rid.ingredients';
                if (time) itemDetailsWhere.push(`rid.time = ?`);
            } else if (parseInt(professionId) === 4) { // Hand Crafter
                itemDetailsTable = 'hc_item_details';
                itemDetailsSelect = ', hcd.time, hcd.ingredients, hcd.additional_data';
                if (time) itemDetailsWhere.push(`hcd.time = ?`);
            }


            let restaurantQuery = `
                SELECT 
                    i.id, i.name, i.price, i.description, i.pictures, i.profession_id,
                    c.name AS creator_name, c.rating, c.has_free_delivery, c.has_offer, c.is_open_now
                    ${itemDetailsSelect}
                FROM items i
                JOIN creators c ON i.creator_id = c.id
            `;
            if (itemDetailsTable) {
                 // استخدام UNION ALL لدمج النتائج من تفاصيل المطاعم و Hand Crafter
                 // هذا النهج أفضل لتوحيد النتائج
                 let restaurantWhere = sqlQueryParts.slice(); // نسخ شروط البحث العامة
                 let restaurantQueryParams = queryParams.slice(); // نسخ البارامترات العامة

                 // فلترة حسب الـ profession_id للمطاعم
                 if (parseInt(professionId) === 1 || parseInt(professionId) === 2) {
                     restaurantWhere.push(`i.profession_id IN (1, 2)`);
                 } else if (parseInt(professionId) === 4) {
                     restaurantWhere.push(`i.profession_id = 4`);
                 } else { // إذا لم يتم تحديد professionId، ابحث في كليهما
                     restaurantWhere.push(`i.profession_id IN (1, 2, 4)`);
                 }

                 if (minRate) {
                     restaurantWhere.push(`c.rating >= ?`);
                     restaurantQueryParams.push(parseFloat(minRate));
                 }
                 if (freeDelivery === 'true') { // قيم الـ query param بتكون String
                     restaurantWhere.push(`c.has_free_delivery = TRUE`);
                 }
                 if (hasOffer === 'true') {
                     restaurantWhere.push(`c.has_offer = TRUE`);
                 }
                 if (isOpenNow === 'true') {
                     restaurantWhere.push(`c.is_open_now = TRUE`);
                 }

                 // بناء الـ WHERE clause
                 let whereClause = restaurantWhere.length > 0 ? `WHERE ${restaurantWhere.join(' AND ')}` : '';

                 // استعلام للمطاعم
                 if (!professionId || parseInt(professionId) === 1 || parseInt(professionId) === 2) {
                     let restQuery = `
                        SELECT
                            i.id, i.name, i.price, i.description, i.pictures, i.profession_id,
                            'restaurant' as item_type, // نضيف نوع لسهولة التعامل في Flutter
                            c.name AS creator_name, c.rating, c.has_free_delivery, c.has_offer, c.is_open_now,
                            rid.time, rid.ingredients
                        FROM items i
                        JOIN creators c ON i.creator_id = c.id
                        LEFT JOIN restaurant_item_details rid ON i.id = rid.item_id
                        ${whereClause} ${whereClause ? 'AND' : 'WHERE'} i.profession_id IN (1, 2)
                        ${time ? `AND rid.time = ?` : ''}
                        LIMIT ? OFFSET ?
                    `;
                    const [rowsRest] = await db.execute(restQuery, [
                        ...restaurantQueryParams,
                        ...(time ? [time] : []),
                        parseInt(limit), parseInt(offset)
                    ]);
                    allResults.push(...rowsRest);
                 }


                 // استعلام لـ Hand Crafter
                 if (!professionId || parseInt(professionId) === 4) {
                     let hcQuery = `
                        SELECT
                            i.id, i.name, i.price, i.description, i.pictures, i.profession_id,
                            'hand_crafter' as item_type, // نضيف نوع لسهولة التعامل في Flutter
                            c.name AS creator_name, c.rating, c.has_free_delivery, c.has_offer, c.is_open_now,
                            hcd.time, hcd.ingredients, hcd.additional_data
                        FROM items i
                        JOIN creators c ON i.creator_id = c.id
                        LEFT JOIN hc_item_details hcd ON i.id = hcd.item_id
                        ${whereClause} ${whereClause ? 'AND' : 'WHERE'} i.profession_id = 4
                        ${time ? `AND hcd.time = ?` : ''}
                        LIMIT ? OFFSET ?
                    `;
                    const [rowsHC] = await db.execute(hcQuery, [
                        ...restaurantQueryParams, // نستخدم نفس البارامترات العامة للمطاعم هنا
                        ...(time ? [time] : []),
                        parseInt(limit), parseInt(offset)
                    ]);
                    allResults.push(...rowsHC);
                 }
            }
        }

        // ---- 2. بحث HS (profession_id 3)
        if (!professionId || parseInt(professionId) === 3) {
            let hsWhere = sqlQueryParts.slice();
            let hsQueryParams = queryParams.slice();

            hsWhere.push(`i.profession_id = 3`);
            if (minRate) { hsWhere.push(`c.rating >= ?`); hsQueryParams.push(parseFloat(minRate)); }
            if (hasOffer === 'true') { hsWhere.push(`c.has_offer = TRUE`); }
            if (working_time) { hsWhere.push(`hsd.working_time = ?`); hsQueryParams.push(working_time); } // افتراضاً working_time موجود في hs_item_details

            let hsQuery = `
                SELECT
                    i.id, i.name, i.price, i.description, i.pictures, i.profession_id,
                    'hand_service' as item_type,
                    c.name AS creator_name, c.rating, c.has_free_delivery, c.has_offer, c.is_open_now,
                    hsd.working_time, hsd.behance_link, hsd.portfolio_links
                FROM items i
                JOIN creators c ON i.creator_id = c.id
                LEFT JOIN hs_item_details hsd ON i.id = hsd.item_id
                ${hsWhere.length > 0 ? `WHERE ${hsWhere.join(' AND ')}` : ''}
                LIMIT ? OFFSET ?
            `;
            const [rowsHS] = await db.execute(hsQuery, [...hsQueryParams, parseInt(limit), parseInt(offset)]);
            allResults.push(...rowsHS);
        }

        // ---- 3. بحث Freelancer (profession_id 5)
        if (!professionId || parseInt(professionId) === 5) {
            let freelancerWhere = sqlQueryParts.slice();
            let freelancerQueryParams = queryParams.slice();

            freelancerWhere.push(`i.profession_id = 5`);
            if (minRate) { freelancerWhere.push(`c.rating >= ?`); freelancerQueryParams.push(parseFloat(minRate)); }
            if (hasOffer === 'true') { freelancerWhere.push(`c.has_offer = TRUE`); }
            if (working_time) { freelancerWhere.push(`fid.working_time = ?`); freelancerQueryParams.push(working_time); } // افتراضاً working_time موجود في freelancer_item_details

            let freelancerQuery = `
                SELECT
                    i.id, i.name, i.price, i.description, i.pictures, i.profession_id,
                    'freelancer' as item_type,
                    c.name AS creator_name, c.rating, c.has_free_delivery, c.has_offer, c.is_open_now,
                    fid.working_time, fid.portfolio_links
                FROM items i
                JOIN creators c ON i.creator_id = c.id
                LEFT JOIN freelancer_item_details fid ON i.id = fid.item_id
                ${freelancerWhere.length > 0 ? `WHERE ${freelancerWhere.join(' AND ')}` : ''}
                LIMIT ? OFFSET ?
            `;
            const [rowsFreelancer] = await db.execute(freelancerQuery, [...freelancerQueryParams, parseInt(limit), parseInt(offset)]);
            allResults.push(...rowsFreelancer);
        }

        // ---- 4. بحث Tutoring (profession_id 6)
        if (!professionId || parseInt(professionId) === 6) {
            let tutoringWhere = sqlQueryParts.slice();
            let tutoringQueryParams = queryParams.slice();

            tutoringWhere.push(`i.profession_id = 6`);
            if (minRate) { tutoringWhere.push(`c.rating >= ?`); tutoringQueryParams.push(parseFloat(minRate)); }
            if (hasOffer === 'true') { tutoringWhere.push(`c.has_offer = TRUE`); }
            if (course_duration) { tutoringWhere.push(`tid.course_duration = ?`); tutoringQueryParams.push(course_duration); } // افتراضاً course_duration موجود في tutoring_item_details

            let tutoringQuery = `
                SELECT
                    i.id, i.name, i.price, i.description, i.pictures, i.profession_id,
                    'tutoring' as item_type,
                    c.name AS creator_name, c.rating, c.has_free_delivery, c.has_offer, c.is_open_now,
                    tid.course_duration, tid.syllabus, tid.google_drive_link
                FROM items i
                JOIN creators c ON i.creator_id = c.id
                LEFT JOIN tutoring_item_details tid ON i.id = tid.item_id
                ${tutoringWhere.length > 0 ? `WHERE ${tutoringWhere.join(' AND ')}` : ''}
                LIMIT ? OFFSET ?
            `;
            const [rowsTutoring] = await db.execute(tutoringQuery, [...tutoringQueryParams, parseInt(limit), parseInt(offset)]);
            allResults.push(...rowsTutoring);
        }


        // بما أن كل استعلام بيرجع عدد محدد من النتائج (limit)، فممكن يكون مجموع النتائج أكثر من الـ limit الأصلي
        // لذلك ممكن تعمل ترتيب وتحديد (limit) بعد تجميع كل النتائج، أو تعتمد على Pagination على مستوى كل نوع
        // للتبسيط في هذا المثال، سنرجع كل ما تم تجميعه.

        // ممكن تعمل فرز إضافي للـ allResults بناءً على الصلة (relevance) أو أي معيار آخر
        // مثلاً: allResults.sort((a, b) => b.rating - a.rating);

        res.status(200).json({
            success: true,
            results: allResults,
            total: allResults.length // ممكن تعمل استعلام COUNT لكل نوع أيضاً لتحصل على العدد الكلي قبل الـ limit
        });

    } catch (error) {
        console.error('Error during search:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


module.exports = {
    addItem, // إذا كانت addItem بنفس الملف
    searchItems,
};
