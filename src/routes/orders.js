const router = require('express').Router();
const { Order, Restaurant, User } = require('../models');
const { protect, role } = require('../middleware/auth');
const { sendPushNotification } = require('../utils/pushNotifications');
const { sendEmail } = require('../utils/emailService');
const { sendSMS } = require('../utils/smsService');

// ── Helper: emit order status to all relevant parties ─────────────────────────
const broadcastStatus = (io, order, extra = {}) => {
  const payload = { orderId: order._id, orderCode: order.orderCode, status: order.status, ...extra };
  io.to(`order:${order._id}`).emit('order:status', payload);
  io.to(`user:${order.customer}`).emit('order:status', payload);
  if (order.rider) io.to(`user:${order.rider}`).emit('order:status', payload);
  io.to(`restaurant:${order.restaurant}`).emit('order:status', payload);
  io.to('admin:room').emit('order:status', payload);
};

// ── Helper: build order data object for notifications ─────────────────────────
const buildOrderData = (order, extra = {}) => ({
  orderCode: order.orderCode,
  restaurantName: order.restaurant?.name,
  itemsSummary: order.items?.map(i => `${i.name} ×${i.quantity}`).join(', '),
  total: order.total,
  subtotal: order.subtotal,
  prepTime: order.prepTime,
  ...extra,
});

// ── GET /api/orders/my — customer's orders ────────────────────────────────────
router.get('/my', protect, role('customer'), async (req, res) => {
  try {
    const orders = await Order.find({ customer: req.user._id })
      .populate('restaurant', 'name address logo rating')
      .populate('rider', 'name phone rating vehicleType')
      .sort('-createdAt')
      .limit(50);
    res.json(orders);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── GET /api/orders/restaurant — restaurant's orders ─────────────────────────
router.get('/restaurant', protect, role('restaurant'), async (req, res) => {
  try {
    const restaurant = await Restaurant.findOne({ owner: req.user._id });
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' });
    const { status } = req.query;
    const filter = { restaurant: restaurant._id, paymentStatus: 'paid' };
    if (status && status !== 'all') filter.status = status;
    const orders = await Order.find(filter)
      .populate('customer', 'name phone')
      .sort('-createdAt');
    res.json(orders);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── GET /api/orders/available — rider sees ready_for_pickup orders ────────────
router.get('/available', protect, role('rider'), async (req, res) => {
  try {
    const orders = await Order.find({ status: 'ready_for_pickup', rider: null })
      .populate('restaurant', 'name address location')
      .populate('customer', 'name phone')
      .sort('-createdAt');
    res.json(orders);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── GET /api/orders/rider/active — rider's active delivery ───────────────────
router.get('/rider/active', protect, role('rider'), async (req, res) => {
  try {
    const order = await Order.findOne({
      rider: req.user._id,
      status: { $in: ['accepted', 'picked_up'] },
    })
      .populate('restaurant', 'name address location')
      .populate('customer', 'name phone');
    res.json(order);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── POST /api/orders/:id/rate — customer rates rider + restaurant ─────────────
router.post('/:id/rate', protect, role('customer'), async (req, res) => {
  try {
    const { riderRating, restaurantRating, riderComment, restaurantComment } = req.body;

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.customer.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Not your order' });
    if (order.status !== 'delivered')
      return res.status(400).json({ message: 'Can only rate delivered orders' });
    if (order.rated)
      return res.status(400).json({ message: 'You have already rated this order' });

    if (riderRating && order.rider) {
      const rider = await User.findById(order.rider);
      if (rider) {
        const totalRatings = rider.totalTrips || 1;
        const currentRating = rider.rating || 5.0;
        const newRating = ((currentRating * (totalRatings - 1)) + riderRating) / totalRatings;
        await User.findByIdAndUpdate(order.rider, {
          rating: Math.round(newRating * 10) / 10,
        });
      }
    }

    if (restaurantRating) {
      const restaurant = await Restaurant.findById(order.restaurant);
      if (restaurant) {
        const totalOrders = restaurant.totalOrders || 1;
        const currentRating = restaurant.rating || 4.5;
        const newRating = ((currentRating * (totalOrders - 1)) + restaurantRating) / totalOrders;
        await Restaurant.findByIdAndUpdate(order.restaurant, {
          rating: Math.round(newRating * 10) / 10,
        });
      }
    }

    await Order.findByIdAndUpdate(req.params.id, {
      rated: true,
      riderRating: riderRating || null,
      restaurantRating: restaurantRating || null,
      riderComment: riderComment || '',
      restaurantComment: restaurantComment || '',
    });

    res.json({ message: 'Thank you for your rating!' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── GET /api/orders/:id — single order ───────────────────────────────────────
router.get('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('restaurant', 'name address location logo rating')
      .populate('customer', 'name phone')
      .populate('rider', 'name phone location rating vehicleType');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(order);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PATCH /api/orders/:id/status — update order status ───────────────────────
router.patch('/:id/status', protect, async (req, res) => {
  try {
    const { status, prepTime, note } = req.body;
    const order = await Order.findById(req.params.id)
      .populate('customer', 'name email phone')
      .populate('restaurant', 'name address');

    if (!order) return res.status(404).json({ message: 'Order not found' });

    const io = req.app.get('io');

    const validTransitions = {
      restaurant: { confirmed: ['pending'], preparing: ['confirmed'], ready_for_pickup: ['preparing'], rejected: ['pending', 'confirmed'] },
      rider: { accepted: ['ready_for_pickup'], picked_up: ['accepted'], delivered: ['picked_up'] },
      admin: { cancelled: ['pending', 'confirmed', 'preparing'], rejected: ['pending'], confirmed: ['pending'], delivered: ['picked_up'] },
    };

    const allowed = validTransitions[req.user.role];
    if (allowed && allowed[status] && !allowed[status].includes(order.status)) {
      return res.status(400).json({ message: `Cannot move from ${order.status} to ${status}` });
    }

    order.status = status;
    if (prepTime) order.prepTime = prepTime;
    if (status === 'accepted') order.rider = req.user._id;
    order.statusHistory.push({ status, note: note || `Status updated to ${status}` });
    await order.save();

    const customer = order.customer;
    const orderData = buildOrderData(order);

    // ── confirmed ─────────────────────────────────────────────────────────────
    if (status === 'confirmed') {
      broadcastStatus(io, order, { prepTime, message: `Restaurant confirmed! Ready in ${prepTime || 20} min` });

      // Push
      if (customer?.pushToken) {
        sendPushNotification(
          customer.pushToken, '✅ Order Confirmed!',
          `${order.restaurant?.name} confirmed your order. Ready in ${prepTime || 20} min`,
          { orderId: order._id.toString(), type: 'order_confirmed' }
        ).catch(() => {});
      }
      // Email + SMS
      if (customer?.email) sendEmail(customer.email, 'orderConfirmed', { ...orderData, prepTime }).catch(() => {});
      if (customer?.phone) sendSMS(customer.phone, 'orderConfirmed', [order.orderCode, order.restaurant?.name, prepTime]).catch(() => {});
    }

    // ── ready_for_pickup ──────────────────────────────────────────────────────
    if (status === 'ready_for_pickup') {
      io.emit('order:available', {
        _id: order._id,
        orderCode: order.orderCode,
        restaurant: order.restaurant,
        total: order.total,
        items: order.items,
        riderEarning: order.riderEarning,
      });
      broadcastStatus(io, order, { message: 'Order is ready! Looking for a rider.' });

      // Push all online riders
      const onlineRiders = await User.find({ role: 'rider', isOnline: true, pushToken: { $exists: true, $ne: '' } });
      for (const rider of onlineRiders) {
        sendPushNotification(
          rider.pushToken, '🛵 New Order Available!',
          `₦${order.riderEarning} delivery from ${order.restaurant?.name || 'a restaurant'}`,
          { orderId: order._id.toString(), type: 'new_order' }
        ).catch(() => {});
      }
    }

    // ── accepted ──────────────────────────────────────────────────────────────
    if (status === 'accepted') {
      broadcastStatus(io, order, { message: 'Rider is on the way to the restaurant!' });

      // Push
      if (customer?.pushToken) {
        sendPushNotification(
          customer.pushToken, '🏍️ Rider Assigned!',
          'A rider has accepted your order and is heading to the restaurant',
          { orderId: order._id.toString(), type: 'rider_assigned' }
        ).catch(() => {});
      }
    }

    // ── picked_up ─────────────────────────────────────────────────────────────
    if (status === 'picked_up') {
      broadcastStatus(io, order, { message: 'Rider has picked up your order!' });

      // Get rider details for notification
      let riderName = '', riderPhone = '';
      try {
        if (order.rider) {
          const rider = await User.findById(order.rider).select('name phone');
          riderName = rider?.name || '';
          riderPhone = rider?.phone || '';
        }
      } catch {}

      // Push
      if (customer?.pushToken) {
        sendPushNotification(
          customer.pushToken, '🛵 Order Picked Up!',
          'Your rider is on the way. Sit tight!',
          { orderId: order._id.toString(), type: 'order_picked_up' }
        ).catch(() => {});
      }
      // Email + SMS
      if (customer?.email) sendEmail(customer.email, 'orderPickedUp', { ...orderData, riderName, riderPhone }).catch(() => {});
      if (customer?.phone) sendSMS(customer.phone, 'orderPickedUp', [order.orderCode, riderName, riderPhone]).catch(() => {});
    }

    // ── delivered ─────────────────────────────────────────────────────────────
    if (status === 'delivered') {
      if (!order.customerConfirmed) {
        return res.status(400).json({ message: 'Customer has not confirmed receipt yet' });
      }

      const commPct = order.commissionPct !== undefined ? order.commissionPct : 10;
      const restaurantPayout = Math.round(order.subtotal * (1 - commPct / 100));

      await Restaurant.findByIdAndUpdate(order.restaurant._id || order.restaurant, {
        $inc: { walletBalance: restaurantPayout, totalOrders: 1, totalRevenue: order.subtotal },
      });
      await User.findByIdAndUpdate(order.rider, {
        $inc: {
          totalEarnings: order.riderEarning,
          weeklyEarnings: order.riderEarning,
          todayEarnings: order.riderEarning,
          totalTrips: 1,
          todayTrips: 1,
        },
      });

      broadcastStatus(io, order, { message: 'Order delivered! Enjoy your meal 🎉' });

      // Push
      if (customer?.pushToken) {
        sendPushNotification(
          customer.pushToken, '🎉 Order Delivered!',
          'Your order has arrived. Enjoy your meal! Please rate your experience.',
          { orderId: order._id.toString(), type: 'order_delivered' }
        ).catch(() => {});
      }
      // Email + SMS
      if (customer?.email) sendEmail(customer.email, 'orderDelivered', orderData).catch(() => {});
      if (customer?.phone) sendSMS(customer.phone, 'orderDelivered', [order.orderCode]).catch(() => {});

      // Notify rider their earnings were credited
      try {
        const rider = await User.findById(order.rider).select('phone email name');
        if (rider?.phone) sendSMS(rider.phone, 'riderDeliveryComplete', [order.orderCode, order.riderEarning]).catch(() => {});
        if (rider?.email) sendEmail(rider.email, 'riderDeliveryComplete', {
          orderCode: order.orderCode,
          riderEarning: order.riderEarning,
          restaurantName: order.restaurant?.name,
        }).catch(() => {});
      } catch {}
    }

    // ── rejected / cancelled ──────────────────────────────────────────────────
    if (status === 'rejected' || status === 'cancelled') {
      broadcastStatus(io, order, { message: `Order ${status}. If you were charged, a refund will be processed.` });

      // Push
      if (customer?.pushToken) {
        sendPushNotification(
          customer.pushToken,
          status === 'rejected' ? '❌ Order Rejected' : '❌ Order Cancelled',
          'If you were charged, a refund will be processed within 24 hours.',
          { orderId: order._id.toString(), type: `order_${status}` }
        ).catch(() => {});
      }
      // Email + SMS
      if (customer?.email) sendEmail(customer.email, 'orderCancelled', orderData).catch(() => {});
      if (customer?.phone) sendSMS(customer.phone, 'orderCancelled', [order.orderCode]).catch(() => {});
    }

    res.json(order);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── POST /api/orders/:id/confirm-received — customer confirms delivery ────────
router.post('/:id/confirm-received', protect, role('customer'), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.customer.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Not your order' });
    if (order.status !== 'picked_up')
      return res.status(400).json({ message: 'Order is not on the way yet' });

    order.customerConfirmed = true;
    order.refundEligible = false;
    await order.save();

    const io = req.app.get('io');
    if (order.rider) {
      io.to(`user:${order.rider}`).emit('order:customer_confirmed', { orderId: order._id });
    }

    res.json({ message: 'Receipt confirmed!' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── GET /api/orders — admin: all orders ──────────────────────────────────────
router.get('/', protect, role('admin'), async (req, res) => {
  try {
    const { status, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate('customer', 'name email')
        .populate('restaurant', 'name')
        .populate('rider', 'name')
        .sort('-createdAt')
        .skip((page - 1) * limit)
        .limit(Number(limit)),
      Order.countDocuments(filter),
    ]);
    res.json({ orders, total });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;