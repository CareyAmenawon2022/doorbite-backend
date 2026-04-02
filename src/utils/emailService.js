const axios = require('axios'); // already installed — used in auth.js

const BRAND = {
  name: 'DoorBite',
  color: '#FF6B2C',
  logo: '🍔',
};

const baseTemplate = (content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${BRAND.name}</title>
</head>
<body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:${BRAND.color};padding:32px;text-align:center;">
            <div style="font-size:48px;margin-bottom:8px;">${BRAND.logo}</div>
            <div style="color:#fff;font-size:28px;font-weight:800;letter-spacing:-0.5px;">${BRAND.name}</div>
            <div style="color:rgba(255,255,255,0.8);font-size:14px;margin-top:4px;">Fast food, faster delivery</div>
          </td>
        </tr>
        <tr><td style="padding:36px 40px;">${content}</td></tr>
        <tr>
          <td style="background:#F8F9FA;padding:24px 40px;text-align:center;border-top:1px solid #E8ECF0;">
            <p style="color:#9CA3AF;font-size:13px;margin:0;">© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.</p>
            <p style="color:#9CA3AF;font-size:12px;margin:8px 0 0;">This is an automated message, please do not reply.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
`;

const orderStatusContent = (title, icon, message, order, extraInfo = '') => `
  <div style="text-align:center;margin-bottom:28px;">
    <div style="font-size:56px;margin-bottom:12px;">${icon}</div>
    <h1 style="color:#1A1A1A;font-size:24px;font-weight:800;margin:0 0 8px;">${title}</h1>
    <p style="color:#6B7280;font-size:15px;margin:0;">${message}</p>
  </div>
  <div style="background:#F8F9FA;border-radius:14px;padding:20px;margin-bottom:20px;">
    <div style="font-size:12px;font-weight:700;color:#9CA3AF;letter-spacing:0.5px;margin-bottom:12px;">ORDER DETAILS</div>
    <table width="100%" cellpadding="6">
      <tr><td style="color:#6B7280;font-size:14px;">Order Code</td><td style="font-weight:700;font-size:14px;text-align:right;">#${order.orderCode}</td></tr>
      <tr><td style="color:#6B7280;font-size:14px;">Restaurant</td><td style="font-weight:700;font-size:14px;text-align:right;">${order.restaurantName || 'Restaurant'}</td></tr>
      <tr><td style="color:#6B7280;font-size:14px;">Items</td><td style="font-weight:700;font-size:14px;text-align:right;">${order.itemsSummary || ''}</td></tr>
      <tr style="border-top:1px solid #E8ECF0;"><td style="color:#1A1A1A;font-size:16px;font-weight:800;padding-top:10px;">Total Paid</td><td style="color:#FF6B2C;font-size:16px;font-weight:800;text-align:right;padding-top:10px;">₦${(order.total || 0).toLocaleString()}</td></tr>
    </table>
  </div>
  ${extraInfo}
`;

// ── EMAIL TEMPLATES ────────────────────────────────────────────────────────────
const templates = {

  emailOtp: ({ name, otp }) => ({
    subject: `${otp} — Your DoorBite verification code`,
    html: baseTemplate(`
      <div style="text-align:center;margin-bottom:28px;">
        <div style="font-size:56px;margin-bottom:12px;">📧</div>
        <h1 style="color:#1A1A1A;font-size:24px;font-weight:800;margin:0 0 8px;">Verify your email</h1>
        <p style="color:#6B7280;font-size:15px;margin:0;">Hi <strong>${name}</strong>, use the code below to verify your DoorBite account.</p>
      </div>
      <div style="text-align:center;margin:32px 0;">
        <div style="display:inline-block;background:#FF6B2C;border-radius:16px;padding:24px 48px;">
          <div style="color:#fff;font-size:42px;font-weight:900;letter-spacing:12px;">${otp}</div>
        </div>
      </div>
      <div style="background:#FFF7ED;border-radius:14px;padding:16px;border-left:4px solid #FF6B2C;margin-bottom:20px;">
        <p style="color:#92400E;font-size:13px;font-weight:600;margin:0;">⏱ This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
      </div>
      <p style="color:#9CA3AF;font-size:13px;text-align:center;margin:0;">
        If you didn't create a DoorBite account, you can safely ignore this email.
      </p>
    `),
  }),

  orderPlaced: (order) => ({
    subject: `✅ Order Confirmed — #${order.orderCode}`,
    html: baseTemplate(orderStatusContent(
      'Order Placed!', '📋',
      "We've received your order and sent it to the restaurant.",
      order,
      `<div style="background:#FFF7ED;border-radius:12px;padding:16px;border-left:4px solid #FF6B2C;">
        <p style="color:#92400E;font-size:14px;font-weight:600;margin:0;">⏱ Estimated delivery time: 25–35 minutes</p>
      </div>`
    )),
  }),

  orderConfirmed: (order) => ({
    subject: `👨‍🍳 Restaurant confirmed your order — #${order.orderCode}`,
    html: baseTemplate(orderStatusContent(
      'Order Confirmed!', '✅',
      `${order.restaurantName} has confirmed your order and is preparing your food.`,
      order,
      `<div style="background:#F0FDF4;border-radius:12px;padding:16px;border-left:4px solid #22C55E;">
        <p style="color:#166534;font-size:14px;font-weight:600;margin:0;">⏱ Ready in approximately ${order.prepTime || 20} minutes</p>
      </div>`
    )),
  }),

  orderPickedUp: (order) => ({
    subject: `🛵 Your order is on the way! — #${order.orderCode}`,
    html: baseTemplate(orderStatusContent(
      'Order Picked Up!', '🛵',
      'Your rider has picked up your order and is heading to you.',
      order,
      order.riderName ? `
      <div style="background:#EFF6FF;border-radius:12px;padding:16px;border-left:4px solid #3B82F6;margin-top:16px;">
        <p style="color:#1D4ED8;font-size:14px;font-weight:700;margin:0 0 4px;">🏍️ Your Rider</p>
        <p style="color:#1D4ED8;font-size:14px;margin:0;">${order.riderName} · ${order.riderPhone || ''}</p>
      </div>` : ''
    )),
  }),

  orderDelivered: (order) => ({
    subject: `🎉 Order delivered! Rate your experience — #${order.orderCode}`,
    html: baseTemplate(orderStatusContent(
      'Order Delivered!', '🎉',
      'Your order has arrived. We hope you enjoy your meal!',
      order,
      `<div style="text-align:center;margin-top:20px;">
        <p style="color:#6B7280;font-size:14px;margin-bottom:12px;">How was your experience? Open the DoorBite app to rate your order.</p>
        <div style="display:inline-block;background:#FF6B2C;color:#fff;padding:12px 28px;border-radius:12px;font-weight:800;font-size:15px;">⭐ Rate your order</div>
      </div>`
    )),
  }),

  orderCancelled: (order) => ({
    subject: `❌ Order cancelled — #${order.orderCode}`,
    html: baseTemplate(orderStatusContent(
      'Order Cancelled', '❌',
      'Your order has been cancelled. If you were charged, a refund will be processed within 24 hours.',
      order,
      `<div style="background:#FEF2F2;border-radius:12px;padding:16px;border-left:4px solid #EF4444;">
        <p style="color:#991B1B;font-size:14px;font-weight:600;margin:0;">💳 Refund will be processed to your original payment method within 24 hours.</p>
      </div>`
    )),
  }),

  refundProcessed: (order) => ({
    subject: `💳 Refund processed — #${order.orderCode}`,
    html: baseTemplate(`
      <div style="text-align:center;margin-bottom:28px;">
        <div style="font-size:56px;margin-bottom:12px;">💳</div>
        <h1 style="color:#1A1A1A;font-size:24px;font-weight:800;margin:0 0 8px;">Refund Processed!</h1>
        <p style="color:#6B7280;font-size:15px;margin:0;">Your refund of <strong style="color:#FF6B2C;">₦${(order.total || 0).toLocaleString()}</strong> has been processed via Paystack.</p>
      </div>
      <div style="background:#F0FDF4;border-radius:14px;padding:20px;text-align:center;">
        <p style="color:#166534;font-size:14px;font-weight:600;margin:0;">✅ Allow 1–3 business days for the funds to reflect in your account.</p>
      </div>
    `),
  }),

  welcomeCustomer: (name) => ({
    subject: `🎉 Welcome to DoorBite, ${name}!`,
    html: baseTemplate(`
      <div style="text-align:center;margin-bottom:28px;">
        <div style="font-size:56px;margin-bottom:12px;">🎉</div>
        <h1 style="color:#1A1A1A;font-size:26px;font-weight:800;margin:0 0 8px;">Welcome, ${name}!</h1>
        <p style="color:#6B7280;font-size:15px;margin:0;">Your DoorBite account is ready. Start ordering your favourite food!</p>
      </div>
      <div style="display:grid;gap:12px;margin-bottom:24px;">
        ${[
          ['🍔', 'Browse restaurants', 'Explore hundreds of restaurants near you'],
          ['⚡', 'Fast delivery', 'Get your food delivered in 25–35 minutes'],
          ['🔒', 'Secure payments', 'Pay safely via Paystack'],
          ['⭐', 'Rate & review', 'Share your experience after every order'],
        ].map(([icon, title, desc]) => `
          <div style="background:#F8F9FA;border-radius:12px;padding:16px;display:flex;align-items:center;gap:14px;">
            <div style="font-size:28px;">${icon}</div>
            <div><div style="font-weight:700;font-size:14px;color:#1A1A1A;">${title}</div><div style="font-size:13px;color:#6B7280;margin-top:2px;">${desc}</div></div>
          </div>
        `).join('')}
      </div>
    `),
  }),

  welcomeRider: (name) => ({
    subject: `🏍️ Welcome to DoorBite Riders, ${name}!`,
    html: baseTemplate(`
      <div style="text-align:center;margin-bottom:28px;">
        <div style="font-size:56px;margin-bottom:12px;">🏍️</div>
        <h1 style="color:#1A1A1A;font-size:26px;font-weight:800;margin:0 0 8px;">Welcome aboard, ${name}!</h1>
        <p style="color:#6B7280;font-size:15px;margin:0;">Your DoorBite rider account is ready. Start delivering and earning today!</p>
      </div>
      <div style="background:#F0FDF4;border-radius:14px;padding:20px;margin-bottom:20px;border-left:4px solid #22C55E;">
        <div style="font-size:12px;font-weight:700;color:#9CA3AF;letter-spacing:0.5px;margin-bottom:10px;">YOUR EARNINGS STRUCTURE</div>
        <table width="100%" cellpadding="6">
          <tr><td style="color:#6B7280;font-size:14px;">Per delivery</td><td style="font-weight:800;font-size:14px;text-align:right;color:#22C55E;">₦900</td></tr>
          <tr><td style="color:#6B7280;font-size:14px;">DoorBite platform fee</td><td style="font-weight:700;font-size:14px;text-align:right;color:#EF4444;">-₦100</td></tr>
          <tr><td style="color:#6B7280;font-size:14px;">Your net per delivery</td><td style="font-weight:800;font-size:16px;text-align:right;color:#22C55E;">₦900</td></tr>
        </table>
      </div>
    `),
  }),

  restaurantSuspended: ({ restaurantName }) => ({
    subject: `⚠️ ${restaurantName} has been suspended`,
    html: baseTemplate(`
      <div style="text-align:center;margin-bottom:28px;">
        <div style="font-size:56px;margin-bottom:12px;">⚠️</div>
        <h1 style="color:#1A1A1A;font-size:24px;font-weight:800;margin:0 0 8px;">Restaurant Suspended</h1>
        <p style="color:#6B7280;font-size:15px;margin:0;"><strong>${restaurantName}</strong> has been temporarily suspended from DoorBite.</p>
      </div>
      <div style="background:#FEF2F2;border-radius:14px;padding:20px;border-left:4px solid #EF4444;">
        <p style="color:#991B1B;font-size:14px;font-weight:600;margin:0;">If you believe this is a mistake, please contact us at support@doorbite.ng</p>
      </div>
    `),
  }),

  restaurantApplicationReceived: ({ ownerName, restaurantName }) => ({
    subject: `📋 Application received — ${restaurantName}`,
    html: baseTemplate(`
      <div style="text-align:center;margin-bottom:28px;">
        <div style="font-size:56px;margin-bottom:12px;">📋</div>
        <h1 style="color:#1A1A1A;font-size:24px;font-weight:800;margin:0 0 8px;">Application Received!</h1>
        <p style="color:#6B7280;font-size:15px;margin:0;">Hi <strong>${ownerName}</strong>, we've received your application for <strong>${restaurantName}</strong>.</p>
      </div>
      <div style="background:#FFF7ED;border-radius:14px;padding:20px;margin-bottom:20px;border-left:4px solid #FF6B2C;">
        <p style="color:#92400E;font-size:14px;font-weight:700;margin:0 0 8px;">⏱ What happens next:</p>
        <ul style="color:#92400E;font-size:14px;margin:0;padding-left:20px;line-height:1.8;">
          <li>Our team will review your application</li>
          <li>Approval takes up to 24 hours</li>
          <li>You'll receive an email once approved</li>
          <li>Then you can log in and set up your menu</li>
        </ul>
      </div>
      <div style="background:#F0FDF4;border-radius:12px;padding:16px;text-align:center;">
        <p style="color:#166534;font-size:13px;font-weight:600;margin:0;">Questions? Email us at support@doorbite.ng</p>
      </div>
    `),
  }),

  restaurantApproved: ({ restaurantName, ownerName }) => ({
    subject: `✅ ${restaurantName} is now live on DoorBite!`,
    html: baseTemplate(`
      <div style="text-align:center;margin-bottom:28px;">
        <div style="font-size:56px;margin-bottom:12px;">🎊</div>
        <h1 style="color:#1A1A1A;font-size:24px;font-weight:800;margin:0 0 8px;">You're live, ${ownerName}!</h1>
        <p style="color:#6B7280;font-size:15px;margin:0;"><strong>${restaurantName}</strong> has been approved and is now visible to customers on DoorBite.</p>
      </div>
      <div style="background:#F0FDF4;border-radius:14px;padding:20px;margin-bottom:20px;border-left:4px solid #22C55E;">
        <p style="color:#166534;font-size:14px;font-weight:700;margin:0 0 8px;">✅ What happens next:</p>
        <ul style="color:#166534;font-size:14px;margin:0;padding-left:20px;line-height:1.8;">
          <li>Log in to your restaurant dashboard</li>
          <li>Add your menu items with photos</li>
          <li>Set your opening hours</li>
          <li>Toggle "Open" to start receiving orders</li>
        </ul>
      </div>
    `),
  }),

  newOrderRestaurant: ({ orderCode, customerName, itemsSummary, total, subtotal, restaurantName }) => ({
    subject: `🔔 New Order #${orderCode} — ${restaurantName}`,
    html: baseTemplate(`
      <div style="text-align:center;margin-bottom:28px;">
        <div style="font-size:56px;margin-bottom:12px;">🔔</div>
        <h1 style="color:#1A1A1A;font-size:24px;font-weight:800;margin:0 0 8px;">New Order!</h1>
        <p style="color:#6B7280;font-size:15px;margin:0;">A new order has been placed at <strong>${restaurantName}</strong>.</p>
      </div>
      <div style="background:#F8F9FA;border-radius:14px;padding:20px;margin-bottom:20px;">
        <div style="font-size:12px;font-weight:700;color:#9CA3AF;letter-spacing:0.5px;margin-bottom:12px;">ORDER DETAILS</div>
        <table width="100%" cellpadding="6">
          <tr><td style="color:#6B7280;font-size:14px;">Order Code</td><td style="font-weight:700;font-size:14px;text-align:right;">#${orderCode}</td></tr>
          <tr><td style="color:#6B7280;font-size:14px;">Customer</td><td style="font-weight:700;font-size:14px;text-align:right;">${customerName || 'Customer'}</td></tr>
          <tr><td style="color:#6B7280;font-size:14px;">Items</td><td style="font-weight:700;font-size:14px;text-align:right;">${itemsSummary}</td></tr>
          <tr><td style="color:#6B7280;font-size:14px;">Subtotal</td><td style="font-weight:700;font-size:14px;text-align:right;">₦${(subtotal||0).toLocaleString()}</td></tr>
          <tr style="border-top:1px solid #E8ECF0;"><td style="color:#1A1A1A;font-size:16px;font-weight:800;padding-top:10px;">Order Total</td><td style="color:#FF6B2C;font-size:16px;font-weight:800;text-align:right;padding-top:10px;">₦${(total||0).toLocaleString()}</td></tr>
        </table>
      </div>
      <div style="background:#FFF7ED;border-radius:12px;padding:16px;border-left:4px solid #FF6B2C;">
        <p style="color:#92400E;font-size:14px;font-weight:700;margin:0;">⚡ Log in to your restaurant dashboard to confirm this order now!</p>
      </div>
    `),
  }),

  riderDeliveryComplete: ({ orderCode, riderEarning, restaurantName }) => ({
    subject: `💰 ₦${riderEarning?.toLocaleString()} earned — Order #${orderCode}`,
    html: baseTemplate(`
      <div style="text-align:center;margin-bottom:28px;">
        <div style="font-size:56px;margin-bottom:12px;">💰</div>
        <h1 style="color:#1A1A1A;font-size:24px;font-weight:800;margin:0 0 8px;">Delivery Complete!</h1>
        <p style="color:#6B7280;font-size:15px;margin:0;">Great job! You've earned <strong style="color:#22C55E;">₦${riderEarning?.toLocaleString()}</strong> for delivering order #${orderCode} from ${restaurantName}.</p>
      </div>
      <div style="background:#F0FDF4;border-radius:14px;padding:20px;margin-bottom:20px;border-left:4px solid #22C55E;">
        <table width="100%" cellpadding="6">
          <tr><td style="color:#6B7280;font-size:14px;">Order</td><td style="font-weight:700;font-size:14px;text-align:right;">#${orderCode}</td></tr>
          <tr><td style="color:#6B7280;font-size:14px;">Restaurant</td><td style="font-weight:700;font-size:14px;text-align:right;">${restaurantName}</td></tr>
          <tr><td style="color:#6B7280;font-size:14px;">Delivery fee</td><td style="font-weight:700;font-size:14px;text-align:right;">₦1,000</td></tr>
          <tr><td style="color:#6B7280;font-size:14px;">DoorBite fee</td><td style="font-weight:700;font-size:14px;text-align:right;color:#EF4444;">-₦100</td></tr>
          <tr style="border-top:1px solid #BBF7D0;"><td style="color:#166534;font-size:16px;font-weight:800;padding-top:10px;">Your earnings</td><td style="color:#22C55E;font-size:16px;font-weight:800;text-align:right;padding-top:10px;">₦${riderEarning?.toLocaleString()}</td></tr>
        </table>
      </div>
      <p style="color:#6B7280;font-size:13px;text-align:center;">Keep delivering to earn more! Withdraw your earnings anytime from the app.</p>
    `),
  }),

};

// ── SEND EMAIL via Brevo HTTP API (port 443 — never blocked by Railway) ────────
const sendEmail = async (to, templateKey, templateData) => {
  if (!process.env.BREVO_API_KEY) {
    console.log(`📧 Email skipped (no BREVO_API_KEY): ${templateKey} to ${to}`);
    return;
  }
  try {
    const template = templates[templateKey]?.(templateData);
    if (!template) { console.warn(`Email template not found: ${templateKey}`); return; }

    await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender:      { name: 'DoorBite', email: process.env.BREVO_SENDER_EMAIL || process.env.BREVO_SMTP_USER },
        to:          [{ email: to }],
        subject:     template.subject,
        htmlContent: template.html,
      },
      {
        headers: {
          'api-key':     process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`📧 Email sent: ${templateKey} → ${to}`);
  } catch (err) {
    console.error(`📧 Email failed: ${templateKey} → ${to}:`, err.response?.data?.message || err.message);
  }
};

module.exports = { sendEmail };