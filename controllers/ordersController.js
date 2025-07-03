const db = require('../config/db');
const sendNotification = require('../controllers/notificationHelper');


exports.placeOrder = async (req, res) => {
    const user_id = req.user.id;
    const {
        creator_id,
        // payment_method لم يعد يُرسل في هذه المرحلة
        shipping_address,
        user_name,
        user_phone,
        notes = null,
        cart_items_details
    } = req.body;

    // التحقق من البيانات الأساسية (بدون payment_method)
    if (!creator_id || !shipping_address || !user_name || !user_phone || !cart_items_details || cart_items_details.length === 0) {
        return res.status(400).json({ success: false, message: "Missing required order details or empty cart." });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        let subtotal = 0.0;
        let delivery_fee = 0.0;
        let discount_amount = 0.0;
        let is_first_order_applied_on_main_order = false;

        const [creatorInfo] = await connection.query(
            `SELECT deliveryValue, fcm_token FROM creators WHERE id = ?`,
            [creator_id]
        );

        let creatorFcmToken = null;
        if (creatorInfo.length > 0) {
            delivery_fee = Number(creatorInfo[0].deliveryValue || 0.0);
            creatorFcmToken = creatorInfo[0].fcm_token;
        }

        for (const item of cart_items_details) {
            const itemBasePrice = Number(item.price);
            let itemExtrasTotal = 0.0;
            if (item.extras && Array.isArray(item.extras)) {
                for (const extra of item.extras) {
                    itemExtrasTotal += Number(extra.price || 0.0);
                }
            }
            const itemTotal = (itemBasePrice + itemExtrasTotal) * item.quantity;
            subtotal += itemTotal;
        }

        const [creatorOffers] = await connection.query(
            `SELECT offer_type, offer_value, offer_start, offer_end
             FROM creator_offers
             WHERE creator_id = ?`,
            [creator_id]
        );
        const now = new Date();

        const freeDeliveryOffer = creatorOffers.find(
            offer => offer.offer_type === 'free_delivery' &&
                     new Date(offer.offer_start) <= now &&
                     new Date(offer.offer_end) >= now
        );
        if (freeDeliveryOffer) {
            delivery_fee = 0.0;
        }

        const [existingOrders] = await connection.query(
            `SELECT COUNT(*) AS order_count FROM orders WHERE user_id = ? AND creator_id = ?`,
            [user_id, creator_id]
        );
        const isFirstOrder = existingOrders[0].order_count === 0;

        const firstOrderOffer = creatorOffers.find(
            offer => offer.offer_type === 'first_order_discount' &&
                     new Date(offer.offer_start) <= now &&
                     new Date(offer.offer_end) >= now
        );

        if (firstOrderOffer && isFirstOrder) {
            try {
                const discountPercentage = parseFloat(firstOrderOffer.offer_value) / 100;
                discount_amount = subtotal * discountPercentage;
                is_first_order_applied_on_main_order = true;
            } catch (e) {
                console.error("Error parsing first order discount value:", e);
            }
        } else {
            const allOrdersOffer = creatorOffers.find(
                offer => offer.offer_type === 'all_orders_discount' &&
                         new Date(offer.offer_start) <= now &&
                         new Date(offer.offer_end) >= now
            );
            if (allOrdersOffer) {
                try {
                    const discountPercentage = parseFloat(allOrdersOffer.offer_value) / 100;
                    discount_amount = subtotal * discountPercentage;
                } catch (e) {
                    console.error("Error parsing all orders discount value:", e);
                }
            }
        }

        if (discount_amount > subtotal) {
            discount_amount = subtotal;
        }

        const finalTotal = subtotal - discount_amount + delivery_fee;
        const total_amount_to_save = Math.max(0.0, finalTotal);

        // إنشاء سجل جديد في جدول 'orders' بحالة 'pending' و payment_method = NULL
        const [orderResult] = await connection.query(
            `INSERT INTO orders (user_id, creator_id, total_amount, discount_amount, delivery_fee, payment_method, shipping_address, user_name, user_phone, notes, payment_status, status)
             VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'unpaid', 'pending')`, // payment_method هو NULL مبدئياً
            [
                user_id,
                creator_id,
                total_amount_to_save,
                discount_amount,
                delivery_fee,
                shipping_address,
                user_name,
                user_phone,
                notes,
            ]
        );
        const orderId = orderResult.insertId;

        // نقل عناصر السلة إلى جدول 'order_items'
        for (const item of cart_items_details) {
            await connection.query(
                `INSERT INTO order_items (order_id, creator_id, item_id, quantity, special_request, price, item_actual_price_at_order, first_order_discount_applied, extras_details)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    orderId,
                    creator_id,
                    item.product_id,
                    item.quantity,
                    item.special_request || null,
                    Number(item.price),
                    Number(item.item_actual_price_at_order || item.price),
                    item.first_order_discount_applied || (is_first_order_applied_on_main_order ? 1 : 0),
                    item.extras ? JSON.stringify(item.extras) : null
                ]
            );
        }

        // إفراغ سلة المشتريات للمستخدم
        await connection.query(
            `DELETE FROM cart WHERE user_id = ?`,
            [user_id]
        );

        // إرسال إشعار للـ Creator وحفظه في قاعدة البيانات
        if (creatorFcmToken) {
            const notificationTitle = "New Order Received!";
            const notificationBody = `You have a new order from ${user_name}. Review it now! Order ID: ${orderId}`;
            const notificationData = {
                orderId: orderId.toString(),
                userId: user_id.toString(),
                userName: user_name,
                userPhone: user_phone, // يمكنك إرسال رقم الهاتف والعنوان هنا أيضاً
                shippingAddress: shipping_address,
                userType: "creator",
                type: "new_order"
            };

            await sendNotification(creatorFcmToken, notificationTitle, notificationBody, notificationData);

            try {
                await connection.query(
                    `INSERT INTO notifications (creator_id, order_id, title, body, data)
                     VALUES (?, ?, ?, ?, ?)`,
                    [creator_id, orderId, notificationTitle, notificationBody, JSON.stringify(notificationData)]
                );
                console.log(`Notification details saved for order ${orderId}.`);
            } catch (saveNotificationError) {
                console.error("Error saving notification details to database:", saveNotificationError);
            }
        } else {
            console.warn(`No FCM token found for creator ${creator_id}. Cannot send notification.`);
        }

        await connection.commit();

        res.status(201).json({
            success: true,
            message: "Order placed successfully! Creator has been notified.",
            orderId: orderId,
            final_total: total_amount_to_save.toFixed(2)
        });

    } catch (err) {
        if (connection) {
            await connection.rollback();
        }
        console.error("Error placing order:", err);
        res.status(500).json({
            success: false,
            message: "An internal server error occurred while placing the order.",
            error: err.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};




exports.updateOrderStatus = async (req, res) => {
    const { orderId } = req.params;
    const { status, delivery_time_value, delivery_time_unit } = req.body;
    const creator_id = req.user.id; // ID الكريتور اللي بيسجل دخول

    // التحقق الأولي من الحالة
    if (!['completed', 'canceled'].includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid order status provided." });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction(); // بدء المعاملة

        // جلب تفاصيل الطلب للتأكد من صلاحية الكريتور والحالة الحالية
        const [orderRows] = await connection.query(
            `SELECT user_id, total_amount, status FROM orders WHERE id = ? AND creator_id = ?`,
            [orderId, creator_id]
        );

        if (orderRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Order not found or you don't have permission." });
        }

        const order = orderRows[0];
        const userId = order.user_id;
        const totalAmount = order.total_amount;
        const currentStatus = order.status;

        // منع تحديث طلب مكتمل أو ملغى بالفعل
        if (['completed', 'canceled'].includes(currentStatus)) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: `Order is already ${currentStatus}.` });
        }

        // --- إذا كانت الحالة المطلوبة هي 'completed' ---
        if (status === 'completed') {
            // التحقق من بيانات وقت التوصيل
            if (
                typeof delivery_time_value === 'undefined' ||
                delivery_time_value <= 0 ||
                !['minutes', 'hours', 'days'].includes(delivery_time_unit)
            ) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: "Valid delivery time and unit (minutes, hours, days) are required."
                });
            }

            let delivery_time_minutes = 0;
            if (delivery_time_unit === 'minutes') delivery_time_minutes = delivery_time_value;
            else if (delivery_time_unit === 'hours') delivery_time_minutes = delivery_time_value * 60;
            else if (delivery_time_unit === 'days') delivery_time_minutes = delivery_time_value * 1440;

            const commissionRate = 0.05; // 5% عمولة
            const commissionAmount = totalAmount * commissionRate;

            // جلب رصيد الـ tokens للكريتور للتحقق
            const [creatorRows] = await connection.query(
                `SELECT tokens FROM creators WHERE id = ?`,
                [creator_id]
            );

            if (creatorRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: "Creator not found." });
            }

            const creatorTokens = Number(creatorRows[0].tokens || 0);
            // التحقق من كفاية الـ tokens لدفع العمولة
            if (creatorTokens < commissionAmount) {
                await connection.rollback();
                return res.status(403).json({
                    success: false,
                    message: `Insufficient tokens. You need ${commissionAmount.toFixed(2)} tokens to complete this order.`
                });
            }

            // 🚀 التعديل هنا:
            // 1. خصم العمولة من الـ tokens
            // 2. زيادة الـ monthly_income بمبلغ الـ total_amount كاملاً
            await connection.query(
                `UPDATE creators SET 
                    tokens = tokens - ?, 
                    monthly_income = COALESCE(monthly_income, 0) + ?, 
                    updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ?`,
                [commissionAmount, totalAmount, creator_id] // هنا `total_amount` يضاف لـ `monthly_income`
            );

            // تحديث حالة الطلب إلى 'completed'
            await connection.query(
                `UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                ['completed', orderId]
            );

            // جلب بيانات المستخدم لإرسال الإشعار
            const [userInfo] = await connection.query(
                `SELECT fcm_token, first_name FROM users WHERE id = ?`,
                [userId]
            );

            // إرسال وتسجيل إشعار للمستخدم
            if (userInfo.length > 0 && userInfo[0].fcm_token) {
                const fcmToken = userInfo[0].fcm_token;
                const userFirstName = userInfo[0].first_name;
                const title = "Your Order is Accepted!";
                const body = `Great news, ${userFirstName}! Your order #${orderId} will arrive in ~${delivery_time_value} ${delivery_time_unit}.`;
                const data = {
                    orderId: orderId.toString(),
                    userId: userId.toString(),
                    type: "order_accepted",
                    deliveryTimeMinutes: delivery_time_minutes.toString(),
                    deliveryTimeValue: delivery_time_value.toString(),
                    deliveryTimeUnit: delivery_time_unit
                };

                // تأكد من أن دالة `sendNotification` موجودة ومستوردة
                // (مفترض أنها موجودة في ملف منفصل أو في نفس الملف)
                await sendNotification(fcmToken, title, body, data);

                await connection.query(
                    `INSERT INTO notifications (user_id, order_id, title, body, data) VALUES (?, ?, ?, ?, ?)`,
                    [userId, orderId, title, body, JSON.stringify(data)]
                );
            }

        }
        // --- إذا كانت الحالة المطلوبة هي 'canceled' ---
        else if (status === 'canceled') {
            // تحديث حالة الطلب إلى 'canceled'
            await connection.query(
                `UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                ['canceled', orderId]
            );

            // جلب بيانات المستخدم لإرسال الإشعار
            const [userInfo] = await connection.query(
                `SELECT fcm_token, first_name FROM users WHERE id = ?`,
                [userId]
            );

            // إرسال وتسجيل إشعار للمستخدم
            if (userInfo.length > 0 && userInfo[0].fcm_token) {
                const fcmToken = userInfo[0].fcm_token;
                const userFirstName = userInfo[0].first_name;
                const title = "Order Canceled!";
                const body = `Hello ${userFirstName}, your order #${orderId} has been canceled by the creator.`;
                const data = {
                    orderId: orderId.toString(),
                    userId: userId.toString(),
                    type: "order_canceled"
                };

                await sendNotification(fcmToken, title, body, data);

                await connection.query(
                    `INSERT INTO notifications (user_id, order_id, title, body, data) VALUES (?, ?, ?, ?, ?)`,
                    [userId, orderId, title, body, JSON.stringify(data)]
                );
            }
        }

        await connection.commit(); // تأكيد المعاملة
        return res.status(200).json({ success: true, message: `Order ${orderId} updated to ${status}.` });

    } catch (err) {
        if (connection) await connection.rollback(); // التراجع عن المعاملة في حالة الخطأ
        console.error("Error updating order:", err);
        return res.status(500).json({ success: false, message: "Server error.", error: err.message });
    } finally {
        if (connection) connection.release(); // تحرير الاتصال بقاعدة البيانات
    }
};


 


exports.acceptOrCancelOrder = async (req, res) => {
    const { orderId } = req.params;
    const { status, delivery_time_value, delivery_time_unit } = req.body;
    const creator_id = req.user.id;

    // الحالة يجب أن تكون 'accepted' أو 'canceled'
    if (!['accepted', 'canceled'].includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid order status provided. Must be 'accepted' or 'canceled'." });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const [orderRows] = await connection.query(
            `SELECT user_id, total_amount, status, user_name FROM orders WHERE id = ? AND creator_id = ?`,
            [orderId, creator_id]
        );

        if (orderRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Order not found or you don't have permission." });
        }

        const order = orderRows[0];
        const userId = order.user_id;
        const currentStatus = order.status;
        const userName = order.user_name;

        // منع تحديث طلب مكتمل أو ملغى أو مقبول بالفعل
        if (['completed', 'canceled', 'accepted'].includes(currentStatus)) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: `Order is already ${currentStatus}. Cannot change status.` });
        }

        // جلب بيانات المستخدم لإرسال الإشعار
        const [userInfo] = await connection.query(
            `SELECT fcm_token, first_name FROM users WHERE id = ?`,
            [userId]
        );
        const userFcmToken = userInfo.length > 0 ? userInfo[0].fcm_token : null;
        const userFirstName = userInfo.length > 0 ? userInfo[0].first_name : "User";

        let notificationTitle, notificationBody, notificationType;
        let deliveryTimeMinutes = null;

        if (status === 'accepted') {
            // التحقق من بيانات وقت التوصيل عند القبول
            if (
                typeof delivery_time_value === 'undefined' ||
                delivery_time_value <= 0 ||
                !['minutes', 'hours', 'days'].includes(delivery_time_unit)
            ) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: "Valid delivery time and unit (minutes, hours, days) are required when accepting an order."
                });
            }

            if (delivery_time_unit === 'minutes') deliveryTimeMinutes = delivery_time_value;
            else if (delivery_time_unit === 'hours') deliveryTimeMinutes = delivery_time_value * 60;
            else if (delivery_time_unit === 'days') deliveryTimeMinutes = delivery_time_value * 1440;

            // تحديث حالة الطلب إلى 'accepted'
            await connection.query(
                `UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                ['accepted', orderId]
            );

            notificationTitle = "Your Order is Accepted!";
            notificationBody = `Great news, ${userFirstName}! Your order #${orderId} has been accepted and will arrive in ~${delivery_time_value} ${delivery_time_unit}. Please proceed to payment.`;
            notificationType = "order_accepted";

        } else if (status === 'canceled') {
            // تحديث حالة الطلب إلى 'canceled'
            await connection.query(
                `UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                ['canceled', orderId]
            );

            notificationTitle = "Order Canceled!";
            notificationBody = `Hello ${userFirstName}, your order #${orderId} has been canceled by the creator.`;
            notificationType = "order_canceled";
        }

        // إرسال وتسجيل إشعار للمستخدم
        if (userFcmToken) {
            const notificationData = {
                orderId: orderId.toString(),
                userId: userId.toString(),
                creatorId: creator_id.toString(),
                type: notificationType,
                ...(status === 'accepted' && {
                    deliveryTimeMinutes: deliveryTimeMinutes.toString(),
                    deliveryTimeValue: delivery_time_value.toString(),
                    deliveryTimeUnit: delivery_time_unit
                })
            };

            await sendNotification(userFcmToken, notificationTitle, notificationBody, notificationData);

            await connection.query(
                `INSERT INTO notifications (user_id, order_id, title, body, data) VALUES (?, ?, ?, ?, ?)`,
                [userId, orderId, notificationTitle, notificationBody, JSON.stringify(notificationData)]
            );
        } else {
             console.warn(`No FCM token found for user ${userId}. Cannot send notification.`);
        }

        await connection.commit();
        return res.status(200).json({ success: true, message: `Order ${orderId} updated to ${status}.` });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("Error updating order status:", err);
        return res.status(500).json({ success: false, message: "Server error.", error: err.message });
    } finally {
        if (connection) connection.release();
    }
};




exports.userConfirmsPayment = async (req, res) => {
    const { orderId } = req.params;
    const { payment_method } = req.body; 
    const user_id = req.user.id; 

    if (!payment_method) {
        return res.status(400).json({ success: false, message: "Payment method is required." });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. جلب تفاصيل الطلب والتأكد من أنه للمستخدم وأن حالته 'accepted' وغير مدفوع
        const [orderRows] = await connection.query(
            `SELECT creator_id, total_amount, status, payment_status FROM orders WHERE id = ? AND user_id = ?`,
            [orderId, user_id]
        );

        if (orderRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Order not found or you don't have permission to confirm payment for this order." });
        }

        const order = orderRows[0];
        const creatorId = order.creator_id;
        const totalAmount = order.total_amount;
        const currentStatus = order.status;
        const currentPaymentStatus = order.payment_status;

        if (currentPaymentStatus === 'paid') {
            await connection.rollback();
            return res.status(400).json({ success: false, message: "Order has already been paid." });
        }

        // يجب أن يكون الطلب في حالة 'accepted' ليتم الدفع
        if (currentStatus !== 'accepted') {
            await connection.rollback();
            return res.status(400).json({ success: false, message: `Order cannot be paid in '${currentStatus}' status. It must be 'accepted' first.` });
        }

        const commissionRate = 0.05; // 5% عمولة
        const commissionAmount = totalAmount * commissionRate;

        // 2. جلب رصيد الـ tokens للكريتور و الـ fcm_token
        const [creatorRows] = await connection.query(
            `SELECT tokens, fcm_token FROM creators WHERE id = ?`,
            [creatorId]
        );

        if (creatorRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Creator not found." });
        }

        const creatorTokens = Number(creatorRows[0].tokens || 0);
        const creatorFcmToken = creatorRows[0].fcm_token;

        // التحقق من كفاية الـ tokens لدفع العمولة
        if (creatorTokens < commissionAmount) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: `Insufficient tokens. Creator needs ${commissionAmount.toFixed(2)} tokens to complete this order.`
            });
        }

        // 3. خصم العمولة من الـ tokens وزيادة الـ monthly_income للكريتور
        await connection.query(
            `UPDATE creators SET
                tokens = tokens - ?,
                monthly_income = COALESCE(monthly_income, 0) + ?,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [commissionAmount, totalAmount, creatorId]
        );

        // 4. تحديث حالة الطلب إلى 'completed' وحالة الدفع إلى 'paid' وتحديد طريقة الدفع
        await connection.query(
            `UPDATE orders SET status = ?, payment_status = ?, payment_method = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            ['completed', 'paid', payment_method, orderId]
        );

        // 💡 5. زيادة نقاط المستخدم الذي أكمل الطلب
        await connection.query(
            `UPDATE users SET points = COALESCE(points, 0) + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [user_id]
        );
        // 💡 رسالة تحذيرية إذا لم يتم العثور على المستخدم (نادراً ما تحدث إذا كان req.user.id صحيحاً)
        // const [userUpdateResult] = await connection.query(...)
        // if (userUpdateResult.affectedRows === 0) { console.warn(`User ${user_id} not found for points update.`); }


        // 6. إرسال وتسجيل إشعار للكريتور بأن الطلب تم دفعه
        if (creatorFcmToken) {
            const notificationTitle = "Order Paid & Completed!";
            const notificationBody = `Order #${orderId} has been paid via ${payment_method}. Your account has been debited ${commissionAmount.toFixed(2)} tokens.`;
            const notificationData = {
                orderId: orderId.toString(),
                userId: user_id.toString(),
                creatorId: creatorId.toString(),
                type: "order_paid",
                paymentMethod: payment_method,
                commissionDeducted: commissionAmount.toFixed(2)
            };

            await sendNotification(creatorFcmToken, notificationTitle, notificationBody, notificationData);

            await connection.query(
                `INSERT INTO notifications (creator_id, order_id, title, body, data) VALUES (?, ?, ?, ?, ?)`,
                [creatorId, orderId, notificationTitle, notificationBody, JSON.stringify(notificationData)]
            );
        } else {
            console.warn(`No FCM token found for creator ${creatorId}. Cannot send payment confirmation notification.`);
        }

        await connection.commit();
        return res.status(200).json({ success: true, message: `Order ${orderId} successfully paid and completed.` });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("Error confirming payment for order:", err);
        return res.status(500).json({ success: false, message: "Server error.", error: err.message });
    } finally {
        if (connection) connection.release();
    }
};




exports.getCreatorOrders = async (req, res) => {
    const creator_id = req.user.id;
    let connection;
    try {
        connection = await db.getConnection();

        // 1. جلب monthly_income الخاص بالكريتور
        const [creatorProfile] = await connection.query(
            `SELECT monthly_income FROM creators WHERE id = ?`,
            [creator_id]
        );

        const monthlyIncome = creatorProfile.length > 0 ? parseFloat(creatorProfile[0].monthly_income) : 0.00;

        // 2. جلب الطلبات مع تفاصيل العناصر والـ extras
        const [orders] = await connection.query(
            `SELECT
                o.id AS order_id,
                o.user_id,
                o.user_name AS user_first_name,
                o.user_phone AS user_phone_number,
                o.total_amount,
                o.status,
                o.payment_method,
                o.shipping_address,
                o.notes,
                o.payment_status,
                o.created_at,
                o.updated_at,
                GROUP_CONCAT(
                    JSON_OBJECT(
                        'item_id', oi.item_id,
                        'item_name', i.name,
                        'quantity', oi.quantity,
                        'price_per_item', oi.item_actual_price_at_order,
                        'special_request', oi.special_request,
                        'extras_details', oi.extras_details -- 💡 تم إضافة extras_details هنا
                    )
                    SEPARATOR '|||'
                ) AS order_items_json
            FROM orders o
            LEFT JOIN order_items oi ON o.id = oi.order_id
            LEFT JOIN items i ON oi.item_id = i.id
            WHERE o.creator_id = ?
            GROUP BY o.id
            ORDER BY o.created_at DESC`,
            [creator_id]
        );

        const parsedOrders = orders.map(order => {
            if (order.order_items_json) {
                const items = order.order_items_json.split('|||').map(itemStr => {
                    try {
                        const parsedItem = JSON.parse(itemStr);
                        // إذا كان extras_details عبارة عن string JSON، قم بتحليله أيضاً
                        if (parsedItem.extras_details && typeof parsedItem.extras_details === 'string') {
                            parsedItem.extras_details = JSON.parse(parsedItem.extras_details);
                        }
                        return parsedItem;
                    } catch (e) {
                        console.error("Error parsing order item JSON or extras_details:", e, itemStr);
                        return null;
                    }
                }).filter(item => item !== null);
                return { ...order, order_items: items };
            }
            return { ...order, order_items: [] };
        });

        connection.release();

        // 3. إرجاع monthly_income ضمن الرد
        res.status(200).json({
            success: true,
            orders: parsedOrders,
            monthly_income: monthlyIncome
        });

    } catch (err) {
        if (connection) connection.release();
        console.error("Error fetching creator orders:", err);
        res.status(500).json({
            success: false,
            message: "An internal server error occurred while fetching creator orders.",
            error: err.message
        });
    }
};





exports.getUserOrders = async (req, res) => {
    const userId = req.user.id;

    console.log('طلب جديد لجلب الطلبات للمستخدم:', userId);

    let connection;
    try {
        connection = await db.getConnection();

        const [orders] = await connection.query(
            `SELECT
                o.id AS order_id,
                o.user_id,
                o.creator_id, -- 💡 ضروري لجلب طرق الدفع للكريتور
                o.total_amount,
                o.payment_method,
                o.shipping_address,
                o.notes,
                o.status,
                o.payment_status,
                o.created_at,
                o.updated_at,
                GROUP_CONCAT(
                    JSON_OBJECT(
                        'item_id', oi.item_id,
                        'item_name', i.name,
                        'quantity', oi.quantity,
                        'price_per_item', oi.item_actual_price_at_order,
                        'special_request', oi.special_request,
                        'extras_details', oi.extras_details
                    )
                    SEPARATOR '|||'
                ) AS order_items_json
            FROM orders o
            JOIN creators c ON o.creator_id = c.id
            LEFT JOIN order_items oi ON o.id = oi.order_id
            LEFT JOIN items i ON oi.item_id = i.id
            WHERE o.user_id = ?
            GROUP BY o.id, o.user_id, o.creator_id, o.total_amount, o.payment_method,
                     o.shipping_address, o.notes, o.status, o.payment_status,
                     o.created_at, o.updated_at
            ORDER BY o.created_at DESC`,
            [userId]
        );

        // جلب طرق الدفع لكل كريتور في الطلبات
        const creatorIds = [...new Set(orders.map(order => order.creator_id))];
        const creatorPaymentMethods = {};

        if (creatorIds.length > 0) {
            const [methods] = await connection.query(
                `SELECT creator_id, method, account_info FROM creator_payment_methods WHERE creator_id IN (?)`,
                [creatorIds]
            );
            methods.forEach(m => {
                if (!creatorPaymentMethods[m.creator_id]) {
                    creatorPaymentMethods[m.creator_id] = [];
                }
                creatorPaymentMethods[m.creator_id].push({
                    method: m.method,
                    account_info: m.account_info
                });
            });
        }

        const formattedOrders = orders.map(order => {
            if (order.order_items_json) {
                order.order_items = order.order_items_json.split('|||').map(itemStr => {
                    try {
                        const parsedItem = JSON.parse(itemStr);
                        if (parsedItem.extras_details && typeof parsedItem.extras_details === 'string') {
                            parsedItem.extras_details = JSON.parse(parsedItem.extras_details);
                        }
                        return parsedItem;
                    } catch (e) {
                        console.error("Error parsing order item JSON or extras_details:", e, itemStr);
                        return null;
                    }
                }).filter(item => item !== null);
            } else {
                order.order_items = [];
            }
            delete order.order_items_json; // نظف الـ JSON string بعد التحويل

            // إضافة طرق الدفع الخاصة بالكريتور لهذا الطلب
            order.creator_payment_methods = creatorPaymentMethods[order.creator_id] || [];

            return order;
        });

        console.log('الطلبات المسترجعة:', formattedOrders);
        res.status(200).json({ orders: formattedOrders });
    } catch (err) {
        console.error('خطأ أثناء جلب طلبات المستخدم:', err);
        res.status(500).json({ success: false, message: 'فشل تحميل الطلبات', error: err.message });
    } finally {
        if (connection) connection.release();
    }
};











