const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.hostinger.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER || 'info@mashru3i.com',
    pass: process.env.EMAIL_PASS || 'Adam123$$312',
  },
  tls: {
    rejectUnauthorized: false 
  }
});

const createEmailTemplate = (title, greeting, message, buttonText, actionUrl) => {
  return `
 <div
      style="
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        max-width: 600px;
        margin: 0 auto;
        border: 1px solid #e1e1e1;
        border-radius: 8px;
        overflow: hidden;
      "
    >
      <div style="background-color: #f2f6f7; padding: 30px; text-align: center">
        <span
          style="
            font-family: 'Arial Black', sans-serif;
            font-size: 32px;
            font-weight: bold;
          "
        >
          <span lang="x-notranslate" style="color: #b0bdb9; font-weight: bold">مَشـ</span>
          <span lang="x-notranslate" style="color: #2cf3c1; font-weight: bold">روعـي</span>
      </div>

      <div style="padding: 30px; direction: rtl; text-align: right">
        <h2 style="color: #2cf3c1; margin-top: 0">${title}</h2>
        <p style="font-size: 16px">${greeting}</p>
        <p style="font-size: 16px">${message}</p>

        <div style="text-align: center; margin: 30px 0">
          <a
            href="${actionUrl}"
            style="
              background-color: #2cf3c1;
              color: black;
              padding: 12px 24px;
              text-decoration: none;
              border-radius: 4px;
              font-weight: bold;
              display: inline-block;
            "
          >
            ${buttonText}
          </a>
        </div>

        <p style="font-size: 14px; color: #7f8c8d">
          إذا لم تطلب هذا الإجراء، يمكنك تجاهل هذه الرسالة بأمان.
        </p>
      </div>

      <div
        style="
          background-color: #f5f5f5;
          padding: 20px;
          text-align: center;
          font-size: 12px;
          color: #7f8c8d;
        "
      >
        <p style="color: #00c28b">
          © ${new Date().getFullYear()} <strong>مَشروعي</strong>. جميع الحقوق
          محفوظة.
        </p>
        <p>
          <a href="https://mashru3i.com/privacy" style="color: #00c28b"
            >سياسة الخصوصية</a
          >
          |
          <a href="https://mashru3i.com/contact" style="color: #00c28b"
            >اتصل بنا</a
          >
        </p>
      </div>
    </div>
  `;
};

async function sendVerificationEmail(to, token) {
  const verifyUrl = `${process.env.APP_BASE_URL}/verify-email?token=${token}`;
  
  const mailOptions = {
    from: '"Mashrou3i فريق الدعم" <info@mashru3i.com>',
    to,
    subject: 'تفعيل حسابك في مشروعي',
    html: createEmailTemplate(
      'تفعيل الحساب',
      'أهلاً بك في مشروعي!',
      'لطفًا قم بالنقر على الزر أدناه لتفعيل حسابك والبدء باستخدام منصتنا.',
      'تفعيل الحساب',
      verifyUrl
    ),
    text: `تفعيل الحساب\n\nأهلاً بك في مشروعي!\n\nلطفًا قم بزيارة الرابط التالي لتفعيل حسابك:\n${verifyUrl}\n\nإذا لم تقم بإنشاء حساب، يمكنك تجاهل هذه الرسالة.`
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('تم إرسال بريد التفعيل بنجاح');
  } catch (error) {
    console.error('خطأ في إرسال بريد التفعيل:', error);
    throw error;
  }
}
async function sendResetPasswordEmail(to, token) {
  const resetUrl = `${process.env.APP_BASE_URL}/reset-password?token=${token}`;
  
  const mailOptions = {
    from: '"Mashrou3i فريق الدعم" <info@mashru3i.com>',
    to,
    subject: 'إعادة تعيين كلمة المرور',
    html: createEmailTemplate(
      'إعادة تعيين كلمة المرور',
      'لقد تلقينا طلبًا لإعادة تعيين كلمة المرور الخاصة بحسابك.',
      'الرابط أدناه صالح لمدة 24 ساعة فقط. انقر على الزر لإعادة تعيين كلمة المرور:',
      'إعادة تعيين كلمة المرور',
      resetUrl
    ),
    text: `إعادة تعيين كلمة المرور\n\nلقد تلقينا طلبًا لإعادة تعيين كلمة المرور.\n\nالرابط الصالح لمدة 24 ساعة:\n${resetUrl}\n\nإذا لم تطلب هذا، يرجى تجاهل هذه الرسالة.`
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('تم إرسال بريد إعادة التعيين بنجاح');
  } catch (error) {
    console.error('خطأ في إرسال بريد إعادة التعيين:', error);
    throw error;
  }
}

module.exports = {
  sendVerificationEmail,
  sendResetPasswordEmail
};