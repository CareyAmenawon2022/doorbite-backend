// ── ALL ROUTES ────────────────────────────────────────────────────────────────
const express = require('express');
const axios = require('axios');
const { User, Restaurant, MenuItem, Order, Withdrawal } = require('../models');
const { protect, role } = require('../middleware/auth');
const { sendEmail } = require('../utils/emailService');
const { sendSMS } = require('../utils/smsService');

const PAYSTACK = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
});

// ── HAVERSINE DISTANCE ────────────────────────────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── RESTAURANTS ───────────────────────────────────────────────────────────────
const restaurantRouter = express.Router();

restaurantRouter.get('/', async (req, res) => {
  try {
    const { cuisine, search, lat, lng } = req.query;
    const filter = { isSuspended: false, isVerified: true };
    if (cuisine) filter.cuisineType = new RegExp(cuisine, 'i');
    if (search) filter.$or = [
      { name: new RegExp(search, 'i') },
      { cuisineType: new RegExp(search, 'i') },
    ];
    const restaurants = await Restaurant.find(filter).select('-bankDetails -walletBalance');
    if (lat && lng) {
      const uLat = parseFloat(lat);
      const uLng = parseFloat(lng);
      const withDist = restaurants.map(r => {
        const rLat = r.location?.lat || 6.3350;
        const rLng = r.location?.lng || 5.6037;
        const dist = haversineKm(uLat, uLng, rLat, rLng);
        return { ...r.toObject(), distance: Math.round(dist * 10) / 10 };
      });
      return res.json(withDist.sort((a, b) => a.distance - b.distance));
    }
    res.json(restaurants);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

restaurantRouter.get('/me', protect, role('restaurant'), async (req, res) => {
  try {
    const r = await Restaurant.findOne({ owner: req.user._id });
    if (!r) return res.status(404).json({ message: 'Restaurant not found' });
    res.json(r);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

restaurantRouter.patch('/me', protect, role('restaurant'), async (req, res) => {
  try {
    const allowed = ['name','description','cuisineType','phone','address','isOpen','openTime','closeTime','bankDetails','logo'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const r = await Restaurant.findOneAndUpdate({ owner: req.user._id }, updates, { new: true });
    res.json(r);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

restaurantRouter.get('/analytics', protect, role('restaurant'), async (req, res) => {
  try {
    const restaurant = await Restaurant.findOne({ owner: req.user._id });
    const today = new Date(); today.setHours(0,0,0,0);
    const weekAgo = new Date(Date.now() - 7*24*60*60*1000);
    const monthAgo = new Date(Date.now() - 30*24*60*60*1000);
    const [todayOrders, weekOrders, monthOrders, allOrders] = await Promise.all([
      Order.find({ restaurant: restaurant._id, createdAt: { $gte: today }, status: 'delivered' }),
      Order.find({ restaurant: restaurant._id, createdAt: { $gte: weekAgo }, status: 'delivered' }),
      Order.find({ restaurant: restaurant._id, createdAt: { $gte: monthAgo }, status: 'delivered' }),
      Order.find({ restaurant: restaurant._id, status: 'delivered' }),
    ]);
    const sum = arr => arr.reduce((s, o) => s + (o.subtotal || 0), 0);
    const grossRevenue = sum(allOrders);
    const platformCut = Math.round(grossRevenue * 0.10 / 0.90);
    const itemCounts = {};
    allOrders.forEach(order => {
      order.items.forEach(item => {
        const name = item.name;
        if (!name) return;
        itemCounts[name] = (itemCounts[name] || 0) + (item.quantity || 1);
      });
    });
    const topItems = Object.entries(itemCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
    res.json({
      todayRevenue: sum(todayOrders), todayOrders: todayOrders.length,
      weekRevenue: sum(weekOrders), weekOrders: weekOrders.length,
      monthRevenue: sum(monthOrders), monthOrders: monthOrders.length,
      allTimeRevenue: sum(allOrders), allTimeOrders: allOrders.length,
      walletBalance: restaurant.walletBalance,
      platformCut,
      grossRevenue: grossRevenue + platformCut,
      topItems,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── MENU ──────────────────────────────────────────────────────────────────────
const menuRouter = express.Router();

menuRouter.get('/:restaurantId', async (req, res) => {
  try {
    const items = await MenuItem.find({ restaurant: req.params.restaurantId });
    res.json(items);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

menuRouter.post('/', protect, role('restaurant'), async (req, res) => {
  try {
    const restaurant = await Restaurant.findOne({ owner: req.user._id });
    const item = await MenuItem.create({ ...req.body, restaurant: restaurant._id });
    res.status(201).json(item);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

menuRouter.patch('/:id', protect, role('restaurant'), async (req, res) => {
  try {
    const item = await MenuItem.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(item);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

menuRouter.delete('/:id', protect, role('restaurant'), async (req, res) => {
  try {
    await MenuItem.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── USERS ─────────────────────────────────────────────────────────────────────
const usersRouter = express.Router();

usersRouter.get('/me', protect, async (req, res) => res.json(req.user));

usersRouter.patch('/me', protect, async (req, res) => {
  try {
    const allowed = ['name','phone','addresses','bankDetails'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-password');
    res.json(user);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

usersRouter.post('/push-token', protect, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { pushToken: req.body.token });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

usersRouter.get('/', protect, role('admin'), async (req, res) => {
  try {
    const { role: r, search, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (r && r !== 'all') filter.role = r;
    if (search) filter.$or = [{ name: new RegExp(search,'i') }, { email: new RegExp(search,'i') }];
    const [users, total] = await Promise.all([
      User.find(filter).select('-password').sort('-createdAt').skip((page-1)*limit).limit(Number(limit)),
      User.countDocuments(filter),
    ]);
    res.json({ users, total });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

usersRouter.patch('/:id/suspend', protect, role('admin'), async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { isSuspended: req.body.isSuspended }, { new: true }).select('-password');
    res.json(user);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── RIDERS ────────────────────────────────────────────────────────────────────
const ridersRouter = express.Router();

ridersRouter.get('/me', protect, role('rider'), async (req, res) => res.json(req.user));

ridersRouter.patch('/online', protect, role('rider'), async (req, res) => {
  try {
    const rider = await User.findByIdAndUpdate(req.user._id, { isOnline: req.body.isOnline }, { new: true });
    res.json({ isOnline: rider.isOnline });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

ridersRouter.patch('/location', protect, role('rider'), async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { location: req.body });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

ridersRouter.get('/history', protect, role('rider'), async (req, res) => {
  try {
    const orders = await Order.find({
      rider: req.user._id,
      status: { $in: ['accepted', 'picked_up', 'delivered'] },
    })
      .populate('restaurant', 'name address')
      .populate('customer', 'name phone')
      .sort('-updatedAt')
      .limit(100);
    res.json(orders);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Admin rider management routes (specific before :id) ───────────────────────
ridersRouter.get('/pending', protect, role('admin'), async (req, res) => {
  try {
    const riders = await User.find({ role: 'rider', isApproved: false, isSuspended: false })
      .select('-password')
      .sort('-createdAt');
    res.json(riders);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

ridersRouter.get('/all', protect, role('admin'), async (req, res) => {
  try {
    const riders = await User.find({ role: 'rider' })
      .select('-password')
      .sort('-createdAt');
    res.json(riders);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

ridersRouter.patch('/:id/approve', protect, role('admin'), async (req, res) => {
  try {
    const rider = await User.findByIdAndUpdate(
      req.params.id,
      { isApproved: true, approvedAt: new Date(), rejectionReason: '' },
      { new: true }
    ).select('-password');
    if (!rider) return res.status(404).json({ message: 'Rider not found' });
    sendEmail(rider.email, 'riderApproved', { riderName: rider.name }).catch(() => {});
    if (rider.phone) sendSMS(rider.phone, 'riderApproved', [rider.name]).catch(() => {});
    res.json(rider);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

ridersRouter.patch('/:id/reject', protect, role('admin'), async (req, res) => {
  try {
    const reason = req.body.reason || 'Does not meet requirements';
    const rider = await User.findByIdAndUpdate(
      req.params.id,
      { isApproved: false, isSuspended: true, rejectionReason: reason },
      { new: true }
    ).select('-password');
    if (!rider) return res.status(404).json({ message: 'Rider not found' });
    sendEmail(rider.email, 'riderRejected', { riderName: rider.name, reason }).catch(() => {});
    res.json(rider);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── WITHDRAWALS ───────────────────────────────────────────────────────────────
const withdrawalsRouter = express.Router();

withdrawalsRouter.post('/', protect, role('restaurant'), async (req, res) => {
  try {
    const restaurant = await Restaurant.findOne({ owner: req.user._id });
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' });
    if (restaurant.walletBalance < req.body.amount)
      return res.status(400).json({ message: 'Insufficient wallet balance' });
    if (!restaurant.bankDetails?.accountNumber)
      return res.status(400).json({ message: 'Please add your bank details in Settings first' });
    const w = await Withdrawal.create({
      requester: req.user._id,
      restaurant: restaurant._id,
      amount: req.body.amount,
      bankDetails: restaurant.bankDetails,
    });
    res.status(201).json(w);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

withdrawalsRouter.post('/rider', protect, role('rider'), async (req, res) => {
  try {
    const rider = await User.findById(req.user._id);
    if (rider.totalEarnings < req.body.amount)
      return res.status(400).json({ message: 'Amount exceeds your earnings balance' });
    if (!rider.bankDetails?.accountNumber)
      return res.status(400).json({ message: 'Please add your bank details in Profile first' });
    const w = await Withdrawal.create({
      requester: req.user._id,
      amount: req.body.amount,
      bankDetails: rider.bankDetails,
    });
    res.status(201).json(w);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

withdrawalsRouter.get('/my', protect, async (req, res) => {
  try {
    const list = await Withdrawal.find({ requester: req.user._id }).sort('-createdAt');
    res.json(list);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

withdrawalsRouter.get('/', protect, role('admin'), async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status && status !== 'all' ? { status } : {};
    const list = await Withdrawal.find(filter)
      .populate('requester', 'name email role')
      .populate('restaurant', 'name')
      .sort('-createdAt');
    res.json(list);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

withdrawalsRouter.patch('/:id', protect, role('admin'), async (req, res) => {
  try {
    const w = await Withdrawal.findById(req.params.id).populate('requester', 'name email role');
    if (!w) return res.status(404).json({ message: 'Withdrawal not found' });
    if (req.body.status === 'approved') {
      try {
        const recipientRes = await PAYSTACK.post('/transferrecipient', {
          type: 'nuban',
          name: w.bankDetails.accountName || w.requester.name,
          account_number: w.bankDetails.accountNumber,
          bank_code: w.bankDetails.bankCode || '058',
          currency: 'NGN',
        });
        const recipientCode = recipientRes.data.data.recipient_code;
        const transferRes = await PAYSTACK.post('/transfer', {
          source: 'balance',
          amount: w.amount * 100,
          recipient: recipientCode,
          reason: `DoorBite withdrawal - ${w.requester.name}`,
          reference: `DB-WD-${w._id}`,
        });
        w.status = 'processing';
        w.paystackTransferCode = transferRes.data.data.transfer_code;
        await w.save();
        return res.json({ ...w.toObject(), message: 'Transfer initiated via Paystack ✓' });
      } catch (paystackErr) {
        console.error('Paystack transfer error:', paystackErr.response?.data || paystackErr.message);
        w.status = 'approved';
        w.adminNote = 'Paystack auto-transfer failed — pay manually';
        await w.save();
        return res.json({ ...w.toObject(), message: 'Approved — Paystack failed, please pay manually' });
      }
    }
    w.status = req.body.status;
    if (req.body.adminNote) w.adminNote = req.body.adminNote;
    await w.save();
    if (req.body.status === 'paid') {
      if (w.restaurant) {
        await Restaurant.findByIdAndUpdate(w.restaurant, { $inc: { walletBalance: -w.amount } });
      } else {
        await User.findByIdAndUpdate(w.requester._id, { $inc: { totalEarnings: -w.amount } });
      }
    }
    res.json(w);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── REFUNDS ───────────────────────────────────────────────────────────────────
const refundsRouter = express.Router();

refundsRouter.post('/:orderId', protect, role('customer'), async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.customer.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Not your order' });
    if (order.refundEligible === false || order.customerConfirmed === true)
      return res.status(400).json({ message: 'Refund not available. You confirmed receipt of this order.' });
    order.refundRequested = true;
    order.refundReason = req.body.reason;
    order.refundStatus = 'requested';
    await order.save();
    res.json(order);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

refundsRouter.get('/', protect, role('admin'), async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { refundRequested: true };
    if (status && status !== 'all') filter.refundStatus = status;
    const orders = await Order.find(filter)
      .populate('customer', 'name email')
      .populate('restaurant', 'name')
      .sort('-createdAt');
    res.json(orders);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

refundsRouter.patch('/:orderId', protect, role('admin'), async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.orderId, { refundStatus: req.body.refundStatus }, { new: true });
    res.json(order);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PROMOTIONS ────────────────────────────────────────────────────────────────
const promotionsRouter = express.Router();

promotionsRouter.get('/', async (req, res) => {
  try {
    const { Promotion } = require('../models');
    const promos = await Promotion.find({ isActive: true }).sort('-createdAt');
    res.json(promos);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

promotionsRouter.get('/all', protect, role('admin'), async (req, res) => {
  try {
    const { Promotion } = require('../models');
    const promos = await Promotion.find().sort('-createdAt');
    res.json(promos);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

promotionsRouter.post('/', protect, role('admin'), async (req, res) => {
  try {
    const { Promotion } = require('../models');
    const promo = await Promotion.create(req.body);
    res.status(201).json(promo);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

promotionsRouter.patch('/:id', protect, role('admin'), async (req, res) => {
  try {
    const { Promotion } = require('../models');
    const promo = await Promotion.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(promo);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

promotionsRouter.delete('/:id', protect, role('admin'), async (req, res) => {
  try {
    const { Promotion } = require('../models');
    await Promotion.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN ─────────────────────────────────────────────────────────────────────
const adminRouter = express.Router();

adminRouter.get('/overview', protect, role('admin'), async (req, res) => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const weekAgo = new Date(Date.now() - 7*24*60*60*1000);
    const [
      customers, riders, restaurants, totalOrders, deliveredOrders,
      todayDelivered, weekDelivered, allDelivered,
      pendingW, pendingR, pendingRestaurants, pendingRiders,
    ] = await Promise.all([
      User.countDocuments({ role: 'customer' }),
      User.countDocuments({ role: 'rider', isApproved: true }),
      Restaurant.countDocuments({ isVerified: true }),
      Order.countDocuments({ paymentStatus: 'paid' }),
      Order.countDocuments({ status: 'delivered' }),
      Order.find({ status: 'delivered', updatedAt: { $gte: today } }),
      Order.find({ status: 'delivered', updatedAt: { $gte: weekAgo } }),
      Order.find({ status: 'delivered' }),
      Withdrawal.countDocuments({ status: 'pending' }),
      Order.countDocuments({ refundStatus: 'requested' }),
      Restaurant.countDocuments({ isVerified: false, isSuspended: false }),
      User.countDocuments({ role: 'rider', isApproved: false, isSuspended: false }),
    ]);
    const gmv = arr => arr.reduce((s, o) => s + (o.total || 0), 0);
    res.json({
      totalUsers: customers,
      totalRiders: riders,
      totalRestaurants: restaurants,
      totalOrders,
      deliveredOrders,
      todayGMV: gmv(todayDelivered),
      weekGMV: gmv(weekDelivered),
      totalGMV: gmv(allDelivered),
      pendingWithdrawals: pendingW,
      pendingRefunds: pendingR,
      pendingRestaurants,
      pendingRiders,              // ← FIXED: now included in response
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

adminRouter.get('/earnings', protect, role('admin'), async (req, res) => {
  try {
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [allOrders, monthOrders] = await Promise.all([
      Order.find({ status: 'delivered', paymentStatus: 'paid' }),
      Order.find({ status: 'delivered', paymentStatus: 'paid', updatedAt: { $gte: monthAgo } }),
    ]);
    const totalFromRestaurants = allOrders.reduce((s, o) => s + Math.round((o.subtotal || 0) * 0.10), 0);
    const totalFromRiders = allOrders.length * 100;
    const totalFromSmallOrders = allOrders.reduce((s, o) => s + (o.smallOrderFee || 0), 0);
    const totalPlatformEarnings = totalFromRestaurants + totalFromRiders + totalFromSmallOrders;
    const monthFromRestaurants = monthOrders.reduce((s, o) => s + Math.round((o.subtotal || 0) * 0.10), 0);
    const monthFromRiders = monthOrders.length * 100;
    const monthFromSmallOrders = monthOrders.reduce((s, o) => s + (o.smallOrderFee || 0), 0);
    const monthPlatformEarnings = monthFromRestaurants + monthFromRiders + monthFromSmallOrders;
    res.json({
      totalPlatformEarnings, totalFromRestaurants, totalFromRiders,
      monthPlatformEarnings, monthFromRestaurants, monthFromRiders,
      monthOrders: monthOrders.length, totalOrders: allOrders.length,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

adminRouter.get('/restaurants/pending', protect, role('admin'), async (req, res) => {
  try {
    const restaurants = await Restaurant.find({ isVerified: false, isSuspended: false })
      .populate('owner', 'name email phone createdAt')
      .sort('-createdAt');
    res.json(restaurants);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

adminRouter.get('/restaurants', protect, role('admin'), async (req, res) => {
  try {
    const restaurants = await Restaurant.find({ isVerified: true })
      .populate('owner', 'name email')
      .sort('-createdAt');
    res.json(restaurants);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

adminRouter.patch('/restaurants/:id/verify', protect, role('admin'), async (req, res) => {
  try {
    const { isVerified, isSuspended } = req.body;
    const restaurant = await Restaurant.findByIdAndUpdate(
      req.params.id,
      { isVerified, isSuspended, ...(isVerified ? { isOpen: true } : {}) },
      { new: true }
    ).populate('owner', 'name email phone');
    if (isVerified && !isSuspended && restaurant?.owner) {
      const { name: ownerName, email, phone } = restaurant.owner;
      sendEmail(email, 'restaurantApproved', { restaurantName: restaurant.name, ownerName }).catch(() => {});
      if (phone) sendSMS(phone, 'restaurantApproved', [restaurant.name]).catch(() => {});
    }
    if (isSuspended && restaurant?.owner) {
      const { email, phone } = restaurant.owner;
      sendEmail(email, 'restaurantSuspended', { restaurantName: restaurant.name }).catch(() => {});
      if (phone) sendSMS(phone, 'restaurantSuspended', [restaurant.name]).catch(() => {});
    }
    res.json(restaurant);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

adminRouter.patch('/restaurants/:id/commission', protect, role('admin'), async (req, res) => {
  try {
    const { percentage, expiresAt, reason, isActive } = req.body;
    const update = {
      commissionOverride: {
        isActive: isActive !== undefined ? isActive : true,
        percentage: percentage !== undefined ? percentage : 10,
        reason: reason || '',
        expiresAt: expiresAt || null,
        setAt: new Date(),
      },
    };
    const r = await Restaurant.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('owner', 'name email');
    res.json(r);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

adminRouter.patch('/restaurants/:id', protect, role('admin'), async (req, res) => {
  try {
    const r = await Restaurant.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(r);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

adminRouter.get('/commission-overrides', protect, role('admin'), async (req, res) => {
  try {
    const restaurants = await Restaurant.find({
      'commissionOverride.isActive': true,
      isVerified: true,
    }).populate('owner', 'name email').select('name commissionOverride owner cuisineType');
    const active = restaurants.filter(r => {
      const exp = r.commissionOverride?.expiresAt;
      return !exp || new Date() < new Date(exp);
    });
    res.json(active);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── CATEGORIES ────────────────────────────────────────────────────────────────
const categoriesRouter = express.Router();

categoriesRouter.get('/', async (req, res) => {
  try {
    const { Category } = require('../models');
    const cats = await Category.find({ isActive: true }).sort('order');
    res.json(cats);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

categoriesRouter.get('/all', protect, role('admin'), async (req, res) => {
  try {
    const { Category } = require('../models');
    const cats = await Category.find().sort('order');
    res.json(cats);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

categoriesRouter.post('/', protect, role('admin'), async (req, res) => {
  try {
    const { Category } = require('../models');
    const count = await Category.countDocuments();
    const cat = await Category.create({ ...req.body, order: count });
    res.status(201).json(cat);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

categoriesRouter.patch('/reorder', protect, role('admin'), async (req, res) => {
  try {
    const { Category } = require('../models');
    await Promise.all(req.body.categories.map(c =>
      Category.findByIdAndUpdate(c._id, { order: c.order })
    ));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

categoriesRouter.patch('/:id', protect, role('admin'), async (req, res) => {
  try {
    const { Category } = require('../models');
    const cat = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(cat);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

categoriesRouter.delete('/:id', protect, role('admin'), async (req, res) => {
  try {
    const { Category } = require('../models');
    await Category.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = {
  restaurantRouter, menuRouter, usersRouter, ridersRouter,
  withdrawalsRouter, refundsRouter, adminRouter, promotionsRouter, categoriesRouter,
};