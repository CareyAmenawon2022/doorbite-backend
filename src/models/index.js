const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ── USER ──────────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phone: String,
  password: { type: String, required: true },
  role: { type: String, enum: ['customer', 'rider', 'restaurant', 'admin'], default: 'customer' },
  isActive: { type: Boolean, default: true },
  isSuspended: { type: Boolean, default: false },
  // Customer
  pushToken: { type: String, default: '' },
  addresses: [{ label: String, address: String, lat: Number, lng: Number }],
  loyaltyPoints: { type: Number, default: 0 },
  // Rider
  vehicleType: String,
  isOnline: { type: Boolean, default: false },
  location: { lat: Number, lng: Number },
  rating: { type: Number, default: 5.0 },
  totalTrips: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  weeklyEarnings: { type: Number, default: 0 },
  todayEarnings: { type: Number, default: 0 },
  todayTrips: { type: Number, default: 0 },
  bankDetails: { bankName: String, accountNumber: String, accountName: String, bankCode: String },
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
userSchema.methods.matchPassword = function(entered) {
  return bcrypt.compare(entered, this.password);
};

// ── RESTAURANT ────────────────────────────────────────────────────────────────
const restaurantSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  description: String,
  cuisineType: String,
  phone: String,
  address: String,
  location: { lat: Number, lng: Number },
  logo: String,
  rating: { type: Number, default: 4.5 },
  totalOrders: { type: Number, default: 0 },
  totalRevenue: { type: Number, default: 0 },
  isOpen: { type: Boolean, default: true },
  openTime: { type: String, default: '08:00' },
  closeTime: { type: String, default: '22:00' },
  isVerified: { type: Boolean, default: true },
  isSuspended: { type: Boolean, default: false },
  bankDetails: { bankName: String, accountNumber: String, accountName: String, bankCode: String },
  walletBalance: { type: Number, default: 0 },
  commissionOverride: {
    isActive: { type: Boolean, default: false },
    percentage: { type: Number, default: 10 },
    reason: { type: String, default: '' },
    expiresAt: { type: Date, default: null },
    setAt: { type: Date, default: null },
  },
}, { timestamps: true });

// ── MENU ITEM ─────────────────────────────────────────────────────────────────
const menuItemSchema = new mongoose.Schema({
  restaurant: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
  name: { type: String, required: true },
  description: String,
  price: { type: Number, required: true },
  category: { type: String, enum: ['Mains', 'Sides', 'Drinks', 'Desserts'], default: 'Mains' },
  image: String,
  isAvailable: { type: Boolean, default: true },
  timesOrdered: { type: Number, default: 0 },
}, { timestamps: true });

// ── ORDER ─────────────────────────────────────────────────────────────────────
const orderSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  restaurant: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
  rider: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  items: [{
    menuItem: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
    name: String,
    price: Number,
    quantity: { type: Number, default: 1 },
  }],
  status: {
    type: String,
    enum: ['awaiting_payment', 'pending', 'confirmed', 'preparing', 'ready_for_pickup', 'accepted', 'picked_up', 'delivered', 'cancelled', 'rejected'],
    default: 'awaiting_payment',
  },
  statusHistory: [{ status: String, time: { type: Date, default: Date.now }, note: String }],
  deliveryAddress: { label: String, address: String, lat: Number, lng: Number },
  subtotal: Number,
  deliveryFee: { type: Number, default: 1000 },
  smallOrderFee: { type: Number, default: 0 },
  serviceFee: { type: Number, default: 0 },
  total: Number,
  paymentMethod: { type: String, default: 'paystack' },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  paystackReference: String,
  paystackAccessCode: String,
  prepTime: Number,
  orderCode: { type: String, unique: true },
  refundRequested: { type: Boolean, default: false },
  refundReason: String,
  refundStatus: { type: String, enum: ['none', 'requested', 'approved', 'refunded', 'rejected'], default: 'none' },
  riderEarning: { type: Number, default: 900 },
  commissionPct: { type: Number, default: 10 },
  customerConfirmed: { type: Boolean, default: false },
  refundEligible: { type: Boolean, default: true },  rated: { type: Boolean, default: false },
  riderRating: { type: Number, min: 1, max: 5, default: null },
  restaurantRating: { type: Number, min: 1, max: 5, default: null },
  riderComment: { type: String, default: '' },
  restaurantComment: { type: String, default: '' },
}, { timestamps: true });

orderSchema.pre('save', function(next) {
  if (!this.orderCode) {
    this.orderCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  }
  next();
});

// ── WITHDRAWAL ────────────────────────────────────────────────────────────────
const withdrawalSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  restaurant: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant' },
  amount: { type: Number, required: true },
  bankDetails: { bankName: String, accountNumber: String, accountName: String, bankCode: String },
  status: { type: String, enum: ['pending', 'approved', 'processing', 'paid', 'rejected'], default: 'pending' },
  adminNote: String,
  paystackTransferCode: String,
  paidAt: Date,
}, { timestamps: true });

// ── PROMOTION ─────────────────────────────────────────────────────────────────
const promotionSchema = new mongoose.Schema({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  bgColor: { type: String, default: '#FF6B2C' },
  emoji: { type: String, default: '🔥' },
  ctaText: { type: String, default: 'Order Now' },
  isActive: { type: Boolean, default: true },
  linkRestaurantId: { type: String, default: '' },
}, { timestamps: true });

// ── CATEGORY ──────────────────────────────────────────────────────────────────
const categorySchema = new mongoose.Schema({
  name:     { type: String, required: true },
  emoji:    { type: String, default: '🍔' },
  color:    { type: String, default: '#FF6B2C' },
  order:    { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const User       = mongoose.model('User', userSchema);
const Restaurant = mongoose.model('Restaurant', restaurantSchema);
const MenuItem   = mongoose.model('MenuItem', menuItemSchema);
const Order      = mongoose.model('Order', orderSchema);
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);
const Promotion  = mongoose.model('Promotion', promotionSchema);
const Category   = mongoose.model('Category', categorySchema);

module.exports = { User, Restaurant, MenuItem, Order, Withdrawal, Promotion, Category };