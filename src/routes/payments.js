const router = require('express').Router();
const axios = require('axios');
const { Order, Restaurant, User } = require('../models');
const { protect, role } = require('../middleware/auth');
const { sendEmail } = require('../utils/emailService');
const { sendSMS } = require('../utils/smsService');

const PAYSTACK = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
});

// Fee structure:
// - Delivery fee:    ₦1,000 (paid by customer)
// - Service fee:     10% of subtotal (paid by customer)
// - Small order fee: ₦500 if subtotal < ₦3,000 (paid by customer, kept by DoorBite)
// - Restaurant gets: (100 - commissionPct)% of subtotal
// - Rider gets:      ₦900 (₦1,000 delivery - ₦100 platform cut)
// - DoorBite keeps:  commissionPct% of subtotal + ₦100 + smallOrderFee

const SMALL_ORDER_THRESHOLD = 3000;
const SMALL_ORDER_FEE = 500;

const calcFees = async (subtotal, restaurantId) => {
  const deliveryFee = 1000;
  const serviceFee = Math.round(subtotal * 0.10);
  const smallOrderFee = subtotal < SMALL_ORDER_THRESHOLD ? SMALL_ORDER_FEE : 0;
  const riderPayout = 900;

  // Check for active commission override
  let commissionPct = 10;
  try {
    const restaurant = await Restaurant.findById(restaurantId).select('commissionOverride');
    if (restaurant?.commissionOverride?.isActive) {
      const override = restaurant.commissionOverride;
      const isExpired = override.expiresAt && new Date() > new Date(override.expiresAt);
      if (!isExpired) {
        commissionPct = override.percentage;
      } else {
        await Restaurant.findByIdAndUpdate(restaurantId, {
          'commissionOverride.isActive': false,
        });
      }
    }
  } catch {}

  const total = subtotal + deliveryFee + serviceFee + smallOrderFee;
  const restaurantPayout = Math.round(subtotal * (1 - commissionPct / 100));
  const platformEarning = Math.round(subtotal * commissionPct / 100) + 100 + smallOrderFee;

  return { deliveryFee, serviceFee, smallOrderFee, total, restaurantPayout, riderPayout, platformEarning, commissionPct };
};

// ── POST /api/payments/initialize ────────────────────────────────────────────
router.post('/initialize', protect, role('customer'), async (req, res) => {
  try {
    const { restaurantId, items, deliveryAddress, smallOrderFee: clientFee } = req.body;
    const { MenuItem } = require('../models');

    // ── Block order if restaurant is closed ───────────────────────────────────
    const restaurantDoc = await Restaurant.findById(restaurantId).select('isOpen name isSuspended isVerified');
    if (!restaurantDoc) {
      return res.status(404).json({ message: 'Restaurant not found' });
    }
    if (restaurantDoc.isSuspended) {
      return res.status(400).json({ message: `${restaurantDoc.name} is currently unavailable.` });
    }
    if (!restaurantDoc.isVerified) {
      return res.status(400).json({ message: `${restaurantDoc.name} is not available on DoorBite.` });
    }
    if (!restaurantDoc.isOpen) {
      return res.status(400).json({
        message: `${restaurantDoc.name} is currently closed. Please try again when they reopen.`,
        code: 'RESTAURANT_CLOSED',
      });
    }

    const menuItems = await MenuItem.find({ _id: { $in: items.map(i => i.menuItem) } });
    let subtotal = 0;
    const orderItems = items.map(i => {
      const mi = menuItems.find(m => m._id.toString() === i.menuItem);
      if (!mi) throw new Error(`Menu item not found: ${i.menuItem}`);
      if (!mi.isAvailable) throw new Error(`${mi.name} is currently unavailable`);
      subtotal += mi.price * i.quantity;
      return { menuItem: mi._id, name: mi.name, price: mi.price, quantity: i.quantity };
    });

    if (subtotal <= 0) {
      return res.status(400).json({ message: 'Order total must be greater than zero' });
    }

    // Always recalculate on backend — never trust client fee
    const { deliveryFee, serviceFee, smallOrderFee, total, riderPayout, commissionPct } = await calcFees(subtotal, restaurantId);

    if (clientFee !== undefined && clientFee !== smallOrderFee) {
      console.warn(`Client sent smallOrderFee=${clientFee} but server calculated ${smallOrderFee}`);
    }

    const order = await Order.create({
      customer: req.user._id,
      restaurant: restaurantId,
      items: orderItems,
      deliveryAddress,
      subtotal,
      deliveryFee,
      serviceFee,
      smallOrderFee,
      total,
      riderEarning: riderPayout,
      commissionPct,
      paymentStatus: 'pending',
      status: 'awaiting_payment',
      statusHistory: [{ status: 'awaiting_payment', note: 'Order created, awaiting payment' }],
    });

    const paystackRes = await PAYSTACK.post('/transaction/initialize', {
      email: req.user.email,
      amount: total * 100,
      reference: `DB-${order._id}`,
      metadata: {
        orderId: order._id.toString(),
        customerId: req.user._id.toString(),
        restaurantId,
      },
      callback_url: `${process.env.CLIENT_URL || 'http://localhost:5000'}/api/payments/callback`,
    });

    order.paystackReference = paystackRes.data.data.reference;
    order.paystackAccessCode = paystackRes.data.data.access_code;
    await order.save();

    res.json({
      orderId: order._id,
      orderCode: order.orderCode,
      total,
      subtotal,
      deliveryFee,
      serviceFee,
      smallOrderFee,
      riderEarning: riderPayout,
      paystackReference: paystackRes.data.data.reference,
      paystackAccessCode: paystackRes.data.data.access_code,
      authorizationUrl: paystackRes.data.data.authorization_url,
    });
  } catch (err) {
    console.error('Payment init error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/payments/verify ─────────────────────────────────────────────────
router.post('/verify', protect, role('customer'), async (req, res) => {
  try {
    const { reference, orderId } = req.body;

    const paystackRes = await PAYSTACK.get(`/transaction/verify/${reference}`);
    const data = paystackRes.data.data;

    if (data.status !== 'success') {
      return res.status(400).json({ message: 'Payment not successful', status: data.status });
    }

    const order = await Order.findById(orderId)
      .populate('customer', 'name email phone')
      .populate('restaurant', 'name address');

    if (!order) return res.status(404).json({ message: 'Order not found' });

    order.paymentStatus = 'paid';
    order.status = 'pending';
    order.statusHistory.push({ status: 'pending', note: 'Payment confirmed, sent to restaurant' });
    await order.save();

    const io = req.app.get('io');

    // ── Socket: notify restaurant ─────────────────────────────────────────────
    io.to(`restaurant:${order.restaurant._id}`).emit('order:new', {
      _id: order._id,
      orderCode: order.orderCode,
      customer: order.customer,
      items: order.items,
      total: order.total,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      serviceFee: order.serviceFee,
      smallOrderFee: order.smallOrderFee,
      status: 'pending',
      createdAt: order.createdAt,
    });

    // ── Socket: notify customer ───────────────────────────────────────────────
    io.to(`user:${req.user._id}`).emit('order:status', {
      orderId: order._id,
      status: 'pending',
      message: 'Payment confirmed! Waiting for restaurant.',
    });

    // ── Build shared order data for notifications ─────────────────────────────
    const orderData = {
      orderCode: order.orderCode,
      restaurantName: order.restaurant?.name,
      itemsSummary: order.items?.map(i => `${i.name} ×${i.quantity}`).join(', '),
      total: order.total,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      serviceFee: order.serviceFee,
      smallOrderFee: order.smallOrderFee,
    };

    // ── Email + SMS: customer order placed ────────────────────────────────────
    const customer = order.customer;
    if (customer?.email) sendEmail(customer.email, 'orderPlaced', orderData).catch(() => {});
    if (customer?.phone) sendSMS(customer.phone, 'orderPlaced', [order.orderCode, order.restaurant?.name]).catch(() => {});

    // ── Email + SMS: notify restaurant owner of new order ─────────────────────
    try {
      const restaurantOwner = await Restaurant.findById(order.restaurant._id).populate('owner', 'phone email');
      if (restaurantOwner?.owner?.phone) {
        sendSMS(restaurantOwner.owner.phone, 'newOrderRestaurant', [
          order.orderCode,
          order.items?.map(i => `${i.name} ×${i.quantity}`).join(', '),
          order.total,
        ]).catch(() => {});
      }
      if (restaurantOwner?.owner?.email) {
        sendEmail(restaurantOwner.owner.email, 'newOrderRestaurant', {
          orderCode: order.orderCode,
          customerName: customer?.name,
          itemsSummary: order.items?.map(i => `${i.name} ×${i.quantity}`).join(', '),
          total: order.total,
          subtotal: order.subtotal,
          restaurantName: order.restaurant?.name,
        }).catch(() => {});
      }
    } catch {}

    res.json({ success: true, order });
  } catch (err) {
    console.error('Payment verify error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/payments/webhook ────────────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  try {
    const event = req.body;
    if (event.event === 'charge.success') {
      const { orderId } = event.data.metadata;
      const order = await Order.findById(orderId);
      if (order && order.paymentStatus !== 'paid') {
        order.paymentStatus = 'paid';
        order.status = 'pending';
        order.statusHistory.push({ status: 'pending', note: 'Payment confirmed via webhook' });
        await order.save();
      }
    }
    res.sendStatus(200);
  } catch (err) {
    res.sendStatus(200);
  }
});

// ── POST /api/payments/refund/:orderId — admin initiates refund ───────────────
router.post('/refund/:orderId', protect, role('admin'), async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId)
      .populate('customer', 'name email phone');
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const refundRes = await PAYSTACK.post('/refund', {
      transaction: order.paystackReference,
      amount: order.total * 100,
    });

    order.paymentStatus = 'refunded';
    order.refundStatus = 'refunded';
    order.statusHistory.push({ status: order.status, note: 'Refund processed via Paystack' });
    await order.save();

    const io = req.app.get('io');
    io.to(`user:${order.customer._id || order.customer}`).emit('order:refunded', {
      orderId: order._id,
      message: `Your refund of ₦${order.total.toLocaleString()} has been processed.`,
    });

    // ── Email + SMS: refund notification to customer ──────────────────────────
    const customer = order.customer;
    if (customer?.email) {
      sendEmail(customer.email, 'refundProcessed', {
        orderCode: order.orderCode,
        total: order.total,
      }).catch(() => {});
    }
    if (customer?.phone) {
      sendSMS(customer.phone, 'refundProcessed', [order.orderCode, order.total]).catch(() => {});
    }

    res.json({ success: true, refund: refundRes.data });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;