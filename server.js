const express = require("express");
const cors = require("cors");
const path = require('path'); // <--- إضافة هذا السطر: استيراد module الـ path

const authRoutes = require('./routes/auth');
const creatorRoutes = require('./routes/creators');
const professionRoutes = require('./routes/professionRoutes');
const ownerRoutes = require('./routes/ownerRoutes');
const creatorInfoRoutes = require('./controllers/creatorInfoController');
const itemRoutes = require('./routes/items');
const creatorItemsRoute = require('./routes/creatorItemsRoute');
const itemsRoutes = require('./routes/itemsRoutes');
const updateProfileImage = require('./routes/updateProfileImage');
const creatorLogin = require('./routes/creatorLogin');
const userItemsRoute = require('./routes/userItemsRoute');
const allCreatorRoute = require('./routes/allCreators');
const addressRoutes = require("./routes/addressRoutes");
const cartRoutes = require("./routes/cartRoutes");
const orderRoutes = require('./routes/orders.routes');
const availabilityRoutes = require("./routes/availabilityRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const offerRoutes = require('./routes/offerRoutes');  
const creatorReview = require('./routes/creatorReviewRoutes');
const fcmRoutes = require('./routes/fcmRoutes'); 
const notificationRoutes = require('./routes/notificationRoutes');
const tokenRequestsRoutes = require('./routes/tokenRequestsRoutes');
const publicRoutes = require('./routes/publicRoutes'); 
const helpRequestRoutes = require('./routes/helpRequestRoutes');



const app = express();
require("dotenv").config();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); // هذا بيخدم الملفات الثابتة مثل CSS/JS داخل public


// --- إضافة هذا التوجيه الجديد هنا ---
// هذا التوجيه بيخلي لما المستخدم يدخل على الرابط /reset-password، سيرفرك يرجع ملف الـ HTML
app.get('/reset-password', (req, res) => {
    // تأكد أن ملف reset-password.html موجود داخل مجلد 'public'
    res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});
// ------------------------------------


app.use('/api/creator-info', creatorInfoRoutes); 
app.use('/api/professions', professionRoutes);
app.use('/api/creators', creatorRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/creator-info', creatorInfoRoutes);
app.use('/api', itemRoutes);
app.use('/api/creator', creatorItemsRoute);
app.use('/api/items', itemsRoutes);
app.use('/api', updateProfileImage);
app.use('/api/auth', authRoutes);
app.use('/api', creatorLogin);
app.use('/api/getItems', userItemsRoute);
app.use('/api/getCreator', allCreatorRoute);
app.use("/api/addresses", addressRoutes);
app.use("/api/cart", cartRoutes);
app.use('/api/orders', orderRoutes);
app.use("/api/availability", availabilityRoutes);
app.use("/api/payment-methods", paymentRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/rate', creatorReview);
app.use('/api', fcmRoutes);
app.use('/api', notificationRoutes); 
app.use('/api/token-requests', tokenRequestsRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/help', helpRequestRoutes);

  

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});


app.get("/", (req, res) => {
  res.status(200).json({ 
    status: "working",
    endpoints: {
      creators: "/api/creators",
      items: "/api/items"
    }
  });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});