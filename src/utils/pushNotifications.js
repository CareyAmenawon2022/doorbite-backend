const axios = require('axios');

const sendPushNotification = async (pushToken, title, body, data = {}) => {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) return;
  try {
    await axios.post('https://exp.host/--/api/v2/push/send', {
      to: pushToken,
      title,
      body,
      data,
      sound: 'default',
      priority: 'high',
    });
  } catch (err) {
    console.error('Push notification error:', err.message);
  }
};

module.exports = { sendPushNotification };