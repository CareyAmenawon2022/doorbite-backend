const axios = require('axios');

const TERMII_BASE = 'https://api.ng.termii.com/api';

// Format Nigerian phone numbers to international format
const formatPhone = (phone) => {
  if (!phone) return null;
  const clean = phone.replace(/\D/g, '');
  if (clean.startsWith('234')) return clean;
  if (clean.startsWith('0')) return '234' + clean.slice(1);
  if (clean.length === 10) return '234' + clean;
  return clean;
};

const SMS_TEMPLATES = {
  orderPlaced:     (code, restaurant) => `DoorBite: Your order #${code} has been placed at ${restaurant}. We'll notify you when it's confirmed. Track in app.`,
  orderConfirmed:  (code, restaurant, mins) => `DoorBite: ✅ ${restaurant} confirmed order #${code}! Ready in ~${mins || 20} mins. Track your order in the app.`,
  orderPickedUp:   (code, riderName, phone) => `DoorBite: 🛵 Your order #${code} is on the way! Rider: ${riderName}${phone ? ` (${phone})` : ''}. ETA: 10-15 mins.`,
  orderDelivered:  (code) => `DoorBite: 🎉 Order #${code} delivered! Enjoy your meal. Please rate your experience in the app.`,
  orderCancelled:  (code) => `DoorBite: ❌ Order #${code} was cancelled. If charged, refund will be processed within 24hrs.`,
  refundProcessed: (code, amount) => `DoorBite: 💳 Refund of ₦${amount?.toLocaleString()} for order #${code} has been processed. Allow 1-3 business days.`,
  welcomeCustomer: (name) => `Welcome to DoorBite, ${name}! 🍔 Order your favourite food and get it delivered in 25-35 mins. Download our app to start.`,
  welcomeRider:    (name) => `Welcome to DoorBite Riders, ${name}! 🏍️ Go online in the app to start accepting deliveries and earn ₦900 per trip.`,
  restaurantApproved: (name) => `DoorBite: 🎊 ${name} is now LIVE on DoorBite! Log in to your dashboard to add menu items and start receiving orders.`,
  riderDeliveryComplete: (code, amount) => `DoorBite: 💰 Delivery complete! ₦${amount?.toLocaleString()} credited to your wallet for order #${code}. Keep it up! 🏍️`,
  restaurantSuspended: (name) => `DoorBite: ⚠️ ${name} has been suspended. Contact support@doorbite.ng if you believe this is a mistake.`,
  restaurantApplicationReceived: (name) => `DoorBite: 📋 Application for ${name} received! Our team will review within 24hrs. You'll be notified once approved.`,
  newOrderRestaurant: (code, items, total) => `DoorBite: 🔔 New order #${code}! ${items}. Total: ₦${total?.toLocaleString()}. Open your dashboard to confirm.`,
};

const sendSMS = async (phone, templateKey, params = []) => {
  if (!process.env.TERMII_API_KEY) {
    console.log(`📱 SMS skipped (no API key): ${templateKey} to ${phone}`);
    return;
  }
  const formattedPhone = formatPhone(phone);
  if (!formattedPhone) { console.warn(`📱 Invalid phone: ${phone}`); return; }
  const templateFn = SMS_TEMPLATES[templateKey];
  if (!templateFn) { console.warn(`📱 SMS template not found: ${templateKey}`); return; }
  const message = templateFn(...params);
  try {
    await axios.post(`${TERMII_BASE}/sms/send`, {
      to: formattedPhone,
      from: process.env.TERMII_SENDER_ID || 'DoorBite',
      sms: message,
      type: 'plain',
      channel: 'generic',
      api_key: process.env.TERMII_API_KEY,
    });
    console.log(`📱 SMS sent: ${templateKey} → ${formattedPhone}`);
  } catch (err) {
    console.error(`📱 SMS failed: ${templateKey} → ${formattedPhone}:`, err.response?.data || err.message);
  }
};

module.exports = { sendSMS };