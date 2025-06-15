const db = require("../config/db");

exports.addToCart = async (req, res) => {
    const user_id = req.user.id; // User ID derived from the authenticated token
    const { product_id, quantity = 1, special_request = null, extras = [] } = req.body;

    if (!product_id) {
        return res.status(400).json({
            success: false,
            message: "Product ID is required."
        });
    }

    if (isNaN(quantity) || quantity < 1) {
        return res.status(400).json({
            success: false,
            message: "Quantity must be a positive number."
        });
    }

    try {
        const [product] = await db.query(
            "SELECT id FROM items WHERE id = ?",
            [product_id]
        );

        if (product.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Product not found."
            });
        }

        const [result] = await db.query(
            `INSERT INTO cart (user_id, product_id, quantity, special_request, extras)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
                quantity = quantity + VALUES(quantity), 
                special_request = VALUES(special_request),
                extras = VALUES(extras)`,
            [
                user_id,
                product_id,
                quantity,
                special_request,
                JSON.stringify(extras)
            ]
        );

        res.status(200).json({
            success: true,
            message: "Product added to cart successfully.",
            cartItemId: result.insertId || result.affectedRows
        });
    } catch (err) {
        console.error("Error adding product to cart:", err);
        res.status(500).json({
            success: false,
            message: "An internal server error occurred.",
            error: err.message
        });
    }
};

exports.getUserCart = async (req, res) => {
    const requestedUserId = parseInt(req.params.userId);
    const authenticatedUserId = req.user.id; // معرف المستخدم من التوكن JWT

    // التحقق الأمني: التأكد من أن المستخدم يطلب سلة تسوقه الخاصة به
    if (isNaN(requestedUserId) || requestedUserId <= 0 || requestedUserId !== authenticatedUserId) {
        return res.status(403).json({
            success: false,
            message: "Unauthorized: You do not have access to this cart."
        });
    }

    try {
        let creatorIdInCart = null; // لتتبع معرف البائع في السلة
        let creatorDeliveryValue = 0.0; // قيمة التوصيل الأساسية للكريتور

        // 1. جلب عناصر السلة مع تفاصيل المنتج وقيمة التوصيل للكريتور
        const [cartItems] = await db.query(`
            SELECT 
                c.id as cart_id,
                c.product_id,
                c.quantity,
                c.special_request,
                c.extras,
                i.name,
                i.price,
                i.pictures,
                i.creator_id,
                cr.deliveryValue
            FROM cart c
            JOIN items i ON c.product_id = i.id
            JOIN creators cr ON i.creator_id = cr.id
            WHERE c.user_id = ?
        `, [authenticatedUserId]);

        let subtotal = 0.0;
        let deliveryFee = 0.0;
        let discountAmount = 0.0;
        let discountMessage = null; 
        let creatorPaymentMethods = []; // لتخزين طرق الدفع المتاحة للكريتور

        const itemsWithCalculatedTotals = cartItems.map(item => {
            if (creatorIdInCart === null) {
                creatorIdInCart = item.creator_id;
                creatorDeliveryValue = Number(item.deliveryValue || 0.0);
            } else if (creatorIdInCart !== item.creator_id) {
                console.warn(`Cart for user ${authenticatedUserId} contains items from multiple creators.`);
                // يمكنك هنا أن تقرر ماذا تفعل: إفراغ السلة، إرجاع خطأ، أو معالجة فقط عناصر الكريتور الأول
            }

            // 1. تحليل حقل 'extras' من الـ JSON string
            let parsedExtras;
            try {
                // التأكد من أن item.extras ليس null أو فارغ قبل التحليل
                if (item.extras && item.extras !== "null" && item.extras.trim() !== "" && item.extras !== "[]") {
                    parsedExtras = JSON.parse(item.extras);
                } else {
                    parsedExtras = [];
                }
            } catch (parseError) {
                console.error("Error parsing extras JSON for cart item ID:", item.cart_id, "Error:", parseError, "Raw extras:", item.extras);
                parsedExtras = []; // في حال الخطأ، نعتبرها فارغة لتجنب تعليق التطبيق
            }

            let extrasTotalPerItem = 0.0;
            let extrasDetails = []; // هذه هي القائمة اللي رح نرجعها في الـ response

            // 2. معالجة وتوحيد تنسيق الـ extras
            if (Array.isArray(parsedExtras) && parsedExtras.length > 0) {
                extrasDetails = parsedExtras.map(extra => {
                    if (typeof extra === 'string') {
                        // حالة البيانات القديمة: "lorem "
                        const defaultExtraPrice = 1.00; // سعر افتراضي للإضافات القديمة
                        extrasTotalPerItem += defaultExtraPrice;
                        return {
                            name: extra,
                            price: defaultExtraPrice
                        };
                    } else if (typeof extra === 'object' && extra !== null && 'name' in extra && 'price' in extra) {
                        // حالة البيانات الجديدة أو المعدلة: {"name":"lorem ","price":10}
                        const extraPrice = Number(extra.price || 0.0);
                        extrasTotalPerItem += extraPrice;
                        return {
                            name: extra.name,
                            price: extraPrice
                        };
                    }
                    // التعامل مع أي تنسيق غير متوقع أو خاطئ
                    console.warn("Unexpected extra format encountered for cart item ID:", item.cart_id, "Extra:", extra);
                    return null; // سيتم إزالة الـ nulls لاحقاً
                }).filter(extra => extra !== null); // إزالة أي عناصر null تم إرجاعها
            }
            
            const itemTotal = (Number(item.price) + extrasTotalPerItem) * item.quantity;
            subtotal += itemTotal;

            return {
                cart_id: item.cart_id,
                product_id: item.product_id,
                quantity: item.quantity,
                special_request: item.special_request || null,
                extras: extrasDetails, // ✅ الآن extrasDetails هي بالتنسيق الصحيح
                name: item.name,
                price: Number(item.price).toFixed(2),
                pictures: (item.pictures) ? JSON.parse(item.pictures) : [],
                creator_id: item.creator_id,
                base_total: (Number(item.price) * item.quantity).toFixed(2),
                extras_total_per_item: extrasTotalPerItem.toFixed(2),
                item_total: itemTotal.toFixed(2)
            };
        });

        // 2. تطبيق العروض وجلب طرق الدفع (فقط إذا كانت السلة غير فارغة ولدينا creatorIdInCart)
        if (cartItems.length > 0 && creatorIdInCart !== null) {
            deliveryFee = creatorDeliveryValue; 

            // جلب عروض الكريتور من جدول creator_offers
            const [creatorOffers] = await db.query(
                `SELECT offer_type, offer_value, offer_start, offer_end 
                 FROM creator_offers 
                 WHERE creator_id = ?`,
                [creatorIdInCart]
            );

            // جلب طرق الدفع للكريتور من جدول creator_payment_methods
            const [paymentMethods] = await db.query(
                `SELECT method, account_info FROM creator_payment_methods WHERE creator_id = ?`,
                [creatorIdInCart]
            );
            creatorPaymentMethods = paymentMethods;

            // التحقق مما إذا كان هذا هو أول طلب للمستخدم من هذا الكريتور
            const [existingOrders] = await db.query(
                `SELECT COUNT(*) AS order_count FROM orders WHERE user_id = ? AND creator_id = ?`,
                [authenticatedUserId, creatorIdInCart]
            );
            const isFirstOrder = existingOrders[0].order_count === 0;
            const now = new Date(); 
            
            // ترتيب تطبيق العروض
            const freeDeliveryOffer = creatorOffers.find(
                offer => offer.offer_type === 'free_delivery' &&
                         new Date(offer.offer_start) <= now &&
                         new Date(offer.offer_end) >= now
            );
            if (freeDeliveryOffer) {
                deliveryFee = 0.0;
                discountMessage = "Free Delivery applied!";
            }

            const firstOrderOffer = creatorOffers.find(
                offer => offer.offer_type === 'first_order_discount' &&
                         new Date(offer.offer_start) <= now &&
                         new Date(offer.offer_end) >= now
            );
            if (firstOrderOffer && isFirstOrder) {
                try {
                    const discountPercentage = parseFloat(firstOrderOffer.offer_value) / 100;
                    discountAmount = subtotal * discountPercentage;
                    discountMessage = (discountMessage ? discountMessage + ", " : "") + 
                                      `First order discount: ${firstOrderOffer.offer_value}% off!`;
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
                        if (discountAmount === 0) { // فقط إذا لم يتم تطبيق خصم "أول طلب"
                            discountAmount = subtotal * discountPercentage;
                            discountMessage = (discountMessage ? discountMessage + ", " : "") + 
                                              `All orders discount: ${allOrdersOffer.offer_value}% off!`;
                        }
                    } catch (e) {
                        console.error("Error parsing all orders discount value:", e);
                    }
                }
            }

            if (discountAmount > subtotal) {
                discountAmount = subtotal;
            }
        }
        
        let finalTotal = subtotal - discountAmount + deliveryFee;
        if (finalTotal < 0) {
            finalTotal = 0.0;
        }

        res.status(200).json({
            success: true,
            data: {
                items: itemsWithCalculatedTotals,
                subtotal: subtotal.toFixed(2),
                delivery_fee: deliveryFee.toFixed(2),
                discount_amount: discountAmount.toFixed(2),
                discount_message: discountMessage,
                total: finalTotal.toFixed(2),
                creator_payment_methods: creatorPaymentMethods 
            }
        });

    } catch (err) {
        console.error("Error fetching cart for user:", err);
        res.status(500).json({
            success: false,
            message: "An internal server error occurred while fetching cart contents.",
            error: err.message
        });
    }
};

exports.removeFromCart = async (req, res) => {
    try {
        const cartId = parseInt(req.params.cartId);
        const authenticatedUserId = req.user.id;

        if (isNaN(cartId) || cartId <= 0) {
            console.log('Invalid ID received:', req.params.cartId);
            return res.status(400).json({
                success: false,
                message: "Cart item ID must be a positive integer."
            });
        }

        const [cartItemCheck] = await db.query(
            "SELECT user_id FROM cart WHERE id = ?",
            [cartId]
        );

        if (cartItemCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Cart item not found."
            });
        }

        if (cartItemCheck[0].user_id !== authenticatedUserId) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized: You cannot remove items from another user's cart."
            });
        }

        console.log(`Attempting to delete cart item with ID: ${cartId} for user: ${authenticatedUserId}`);

        const [result] = await db.query(
            "DELETE FROM cart WHERE id = ? AND user_id = ?",
            [cartId, authenticatedUserId]
        );

        console.log('Delete result:', result);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Cart item not found or you do not have permission to delete it."
            });
        }

        res.status(200).json({
            success: true,
            message: "Item removed from cart successfully.",
            deletedId: cartId
        });

    } catch (err) {
        console.error("Error in removeFromCart:", err);
        res.status(500).json({
            success: false,
            message: "An internal server error occurred.",
            error: err.message
        });
    }
};

exports.updateCartItemQuantity = async (req, res) => {
    const { cartId } = req.params;
    const { quantity } = req.body;
    const authenticatedUserId = req.user.id;

    if (isNaN(cartId) || cartId <= 0) {
        return res.status(400).json({
            success: false,
            message: "Cart item ID is invalid. It must be a positive integer."
        });
    }

    if (isNaN(quantity) || quantity < 1) {
        return res.status(400).json({
            success: false,
            message: "Quantity must be a positive number."
        });
    }

    try {
        const [cartItemCheck] = await db.query(
            "SELECT user_id FROM cart WHERE id = ?",
            [cartId]
        );

        if (cartItemCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Cart item not found for update."
            });
        }

        if (cartItemCheck[0].user_id !== authenticatedUserId) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized: You cannot update an item in another user's cart."
            });
        }

        const [result] = await db.query(
            "UPDATE cart SET quantity = ? WHERE id = ? AND user_id = ?",
            [quantity, cartId, authenticatedUserId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Cart item not updated. It might not exist, or you lack permission."
            });
        }

        res.status(200).json({
            success: true,
            message: "Cart item quantity updated successfully.",
            cartItemId: cartId,
            newQuantity: quantity
        });
    } catch (err) {
        console.error("Error updating cart item quantity:", err);
        res.status(500).json({
            success: false,
            message: "An internal server error occurred while updating quantity.",
            error: err.message
        });
    }
};

exports.clearUserCart = async (req, res) => {
    const requestedUserId = parseInt(req.params.userId);
    const authenticatedUserId = req.user.id;

    if (isNaN(requestedUserId) || requestedUserId <= 0 || requestedUserId !== authenticatedUserId) {
        return res.status(403).json({
            success: false,
            message: "Unauthorized: You do not have permission to clear this cart."
        });
    }

    try {
        const [result] = await db.query(
            "DELETE FROM cart WHERE user_id = ?",
            [authenticatedUserId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "User's cart is already empty or user not found."
            });
        }

        res.status(200).json({
            success: true,
            message: "Cart cleared successfully.",
            clearedForUser: authenticatedUserId
        });
    } catch (err) {
        console.error("Error clearing user cart:", err);
        res.status(500).json({
            success: false,
            message: "An internal server error occurred while clearing the cart.",
            error: err.message
        });
    }
};