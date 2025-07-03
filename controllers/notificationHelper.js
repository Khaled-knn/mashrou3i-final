const admin = require('../config/firebaseAdmin'); 

async function sendNotification(fcmToken, title, body, data) {
    const message = {
        token: fcmToken,
        notification: {
            title: title,
            body: body,
        },
        data: data, 
    };

    try {
        const response = await admin.messaging().send(message); // <--- استخدم admin.messaging() مباشرةً
        console.log('✅ Successfully sent message:', response);
    } catch (error) {
        console.error('Error sending message:', error);
        if (error.code === 'messaging/invalid-argument' || error.code === 'messaging/registration-token-not-registered') {
            console.warn(`Removing invalid/expired FCM token: ${fcmToken}`);
        }
    }
}

module.exports = sendNotification;