const db = require('../config/db');

class ItemsService {
  static async fetchUserItems(creatorId) {
    const [basicItems] = await db.execute(
      'SELECT * FROM items WHERE creator_id = ?',
      [creatorId]
    );

    if (basicItems.length === 0) return [];

    const detailedItems = await Promise.all(
      basicItems.map(async (item) => {
        let details = {};

        // **تصحيح الـ switch case بناءً على المهام السابقة**
        switch (item.profession_id) {
          case 1: // Food Chef
          case 2: // Sweet Chef
            [details] = await db.execute(
              'SELECT time, ingredients FROM restaurant_item_details WHERE item_id = ?',
              [item.id]
            );
            break;
          case 3: // Home Services (HS)
            [details] = await db.execute(
              'SELECT working_time, behance_link, portfolio_links FROM hs_item_details WHERE item_id = ?', // كان craft_item_details
              [item.id]
            );
            break;
          case 4: // Hand Crafter (HC)
            // بما أنك ذكرت أن profession id 1 و 2 و 4 هم نفس معلومات restaurant table،
            // لكن الكود السابق استخدم hc_item_details وهذا الأصح إذا كانت لها جداولها الخاصة.
            // لنفترض أن HC لها جدولها الخاص `hc_item_details` كما في دالة `addItem` السابقة.
            [details] = await db.execute(
              'SELECT time, ingredients, additional_data FROM hc_item_details WHERE item_id = ?', // كان teaching_item_details
              [item.id]
            );
            break;
          case 5: // Freelancer
            [details] = await db.execute(
              'SELECT working_time, portfolio_links FROM freelancer_item_details WHERE item_id = ?',
              [item.id]
            );
            break;
          case 6: // Tutoring
            [details] = await db.execute(
              'SELECT course_duration, syllabus, google_drive_link FROM tutoring_item_details WHERE item_id = ?', // أضفنا google_drive_link
              [item.id]
            );
            break;
        }

        const itemDetails = details[0] || null;

        // تحليل الـ JSON لـ ingredients
        if ((item.profession_id === 1 || item.profession_id === 2 || item.profession_id === 4) && itemDetails?.ingredients) {
          try {
            itemDetails.ingredients = JSON.parse(itemDetails.ingredients);
          } catch (e) {
            console.error(`Failed to parse ingredients for item ${item.id}:`, e);
          }
        }
        
        // تحليل الـ JSON لـ portfolio_links (لـ HS و Freelancer)
        if ((item.profession_id === 3 || item.profession_id === 5) && itemDetails?.portfolio_links) {
          try {
            itemDetails.portfolio_links = JSON.parse(itemDetails.portfolio_links);
          } catch (e) {
            console.error(`Failed to parse portfolio_links for item ${item.id}:`, e);
          }
        }

        // تحليل الـ JSON لـ pictures (common for all items)
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

    return detailedItems;
  }

  static async deleteItem(itemId, creatorId) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      console.log('DEBUG: itemId received in deleteItem service:', itemId);
      console.log('DEBUG: creatorId received in deleteItem service:', creatorId);

      const [item] = await connection.execute(
        'SELECT profession_id FROM items WHERE id = ? AND creator_id = ?',
        [itemId, creatorId]
      );

      if (item.length === 0) {
        throw new Error('Item not found or unauthorized');
      }

      const professionId = item[0].profession_id;
      console.log('DEBUG: professionId of item to delete:', professionId);

      // **تحديث detailTables لتعكس أسماء الجداول الصحيحة لكل profession_id**
      const detailTables = {
        1: 'restaurant_item_details',
        2: 'restaurant_item_details',
        3: 'hs_item_details',           // Home Services
        4: 'hc_item_details',           // Hand Crafter
        5: 'freelancer_item_details',   // Freelancer
        6: 'tutoring_item_details'      // Tutoring
      };
      console.log('DEBUG: detailTables configuration:', detailTables);

      if (detailTables[professionId]) {
        const detailTableName = detailTables[professionId];
        const deleteDetailsQuery = `DELETE FROM ${detailTableName} WHERE item_id = ?`;
        console.log('DEBUG: Executing delete details query:', deleteDetailsQuery, [itemId]);
        await connection.execute(deleteDetailsQuery, [itemId]);
      }

      const deleteItemQuery = 'DELETE FROM items WHERE id = ?';
      console.log('DEBUG: Executing delete item query:', deleteItemQuery, [itemId]);
      await connection.execute(deleteItemQuery, [itemId]);

      await connection.commit();
      return { success: true };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // دالة التحقق من الوقت
  static async canEditItem(itemId, creatorId) {
    const [item] = await db.execute(
      'SELECT created_at FROM items WHERE id = ? AND creator_id = ?',
      [itemId, creatorId]
    );

    if (item.length === 0) return { canEdit: false, reason: 'Item not found or unauthorized' };

    const createdAt = new Date(item[0].created_at);
    const hoursDiff = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60); // استخدام getTime()
    
    if (hoursDiff <= 27) {
      return { canEdit: true, free: true }; // تعديل مجاني
    } else {
      return { canEdit: true, free: false }; // يحتاج لتوكنز
    }
  }

  // دالة التعديل
  static async updateItem(itemId, creatorId, updateData) {
    const connection = await db.getConnection();
    await connection.beginTransaction();
    
    // 1. **التعديل هنا:** تعريف متغير tokensDeducted في نطاق الدالة العام وإعطاؤه قيمة افتراضية 0.
    let tokensDeducted = 0; 

    try {
        const editStatus = await ItemsService.canEditItem(itemId, creatorId);

        if (!editStatus.canEdit) {
            throw new new Error(editStatus.reason || 'Item cannot be edited.');
        }

        if (!editStatus.free) {
            // إذا لم يكن التعديل مجانيًا (بعد 24 ساعة)، نخصم التوكنز
            const [creatorRows] = await connection.execute(
                'SELECT tokens FROM creators WHERE id = ? FOR UPDATE',
                [creatorId]
            );

            if (creatorRows.length === 0) {
                throw new Error('Creator not found');
            }

            const currentTokens = parseFloat(creatorRows[0].tokens);
            const tokensRequired = 5; // هذا التعريف هنا صحيح، لأنه يستخدم داخل هذا البلوك فقط.

            if (isNaN(currentTokens) || currentTokens < tokensRequired) {
                throw new Error(`Insufficient tokens. Required: ${tokensRequired}, Available: ${currentTokens}`);
            }

            // خصم التوكنز
            await connection.execute(
                'UPDATE creators SET tokens = tokens - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [tokensRequired, creatorId]
            );
            console.log(`Deducted ${tokensRequired} tokens from creator ${creatorId} for updating item ${itemId}.`);
            
            // 2. **التعديل هنا:** تحديث قيمة tokensDeducted التي تم تعريفها في النطاق الأوسع.
            tokensDeducted = tokensRequired; 
        }

        // الحصول على profession_id للعنصر (لازم نجيبها قبل تحديث التفاصيل)
        const [itemResult] = await connection.execute(
            'SELECT profession_id FROM items WHERE id = ? AND creator_id = ?',
            [itemId, creatorId]
        );

        if (itemResult.length === 0) {
            throw new Error('Item not found or unauthorized for update.');
        }
        const professionId = itemResult[0].profession_id;

        // تحديث الجدول الرئيسي
        const commonUpdateFields = ['name', 'price', 'description'];
        const commonUpdateValues = [updateData.name, updateData.price, updateData.description];

        const setClauses = commonUpdateFields
            .filter(field => updateData[field] !== undefined)
            .map(field => `${field} = ?`);
        
        const values = commonUpdateFields
            .filter(field => updateData[field] !== undefined)
            .map(field => updateData[field]);

        if (updateData.pictures !== undefined) {
            setClauses.push('pictures = ?');
            values.push(updateData.pictures.length > 0 ? JSON.stringify(updateData.pictures) : null);
        }

        setClauses.push('updated_at = CURRENT_TIMESTAMP'); // تحديث وقت التعديل

        if (setClauses.length > 1) { // 1 لأن updated_at ستضاف دائماً
            const updateItemQuery = `UPDATE items SET ${setClauses.join(', ')} WHERE id = ? AND creator_id = ?`;
            await connection.execute(
                updateItemQuery,
                [...values, itemId, creatorId]
            );
        }
        
        // 2. تحديث الجداول الفرعية حسب النوع (يجب أن تكون شاملة لكل الحقول الممكنة)
        // تذكر: القيم التي تُرسل هنا يجب أن تتوافق مع ما هو موجود في updateData
        if (professionId === 1 || professionId === 2) { // Food/Sweet Chef
            await connection.execute(
                'UPDATE restaurant_item_details SET time = ?, ingredients = ? WHERE item_id = ?',
                [updateData.time, updateData.ingredients ? JSON.stringify(updateData.ingredients) : null, itemId]
            );
        } else if (professionId === 3) { // Home Services
            await connection.execute(
                'UPDATE hs_item_details SET working_time = ?, behance_link = ?, portfolio_links = ? WHERE item_id = ?',
                [updateData.working_time, updateData.behance_link, updateData.portfolio_links ? JSON.stringify(updateData.portfolio_links) : null, itemId]
            );
        } else if (professionId === 4) { // Hand Crafter
            await connection.execute(
                'UPDATE hc_item_details SET time = ?, ingredients = ?, additional_data = ? WHERE item_id = ?',
                [updateData.time, updateData.ingredients ? JSON.stringify(updateData.ingredients) : null, updateData.additional_data, itemId]
            );
        } else if (professionId === 5) { // Freelancer
            await connection.execute(
                'UPDATE freelancer_item_details SET working_time = ?, portfolio_links = ? WHERE item_id = ?',
                [updateData.working_time, updateData.portfolio_links ? JSON.stringify(updateData.portfolio_links) : null, itemId]
            );
        } else if (professionId === 6) { // Tutoring
            await connection.execute(
                'UPDATE tutoring_item_details SET course_duration = ?, syllabus = ?, google_drive_link = ? WHERE item_id = ?',
                [updateData.course_duration, updateData.syllabus, updateData.google_drive_link, itemId]
            );
        }
        // إذا كان هناك profession_id لم يُحدد له جدول تفاصيل، لن يتم فعل شيء هنا
        
        await connection.commit();
        // 3. **التعديل هنا:** استخدم المتغير tokensDeducted المعرف في النطاق الأوسع.
        return { success: true, message: 'Item updated successfully', tokensDeducted: tokensDeducted };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}
}

module.exports = ItemsService;