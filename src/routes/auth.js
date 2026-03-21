const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { User, Restaurant } = require('../models');
const { sendEmail } = require('../utils/emailService');
const { sendSMS } = require('../utils/smsService');

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });

// POST /api/auth/register — customer & rider
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone, role, vehicleType, restaurantName } = req.body;

    if (await User.findOne({ email }))
      return res.status(400).json({ message: 'Email already registered' });

    const user = await User.create({
      name, email, password, phone,
      role: role || 'customer',
      vehicleType,
    });

    if (role === 'restaurant') {
      await Restaurant.create({
        owner: user._id,
        name: restaurantName || name + "'s Restaurant",
        phone,
        isVerified: true,
      });
    }

    // ── Welcome notifications (non-blocking) ─────────────────────────────────
    if (user.role === 'customer') {
      sendEmail(user.email, 'welcomeCustomer', user.name).catch(() => {});
      if (user.phone) sendSMS(user.phone, 'welcomeCustomer', [user.name]).catch(() => {});
    }

    if (user.role === 'rider') {
      sendEmail(user.email, 'welcomeRider', user.name).catch(() => {});
      if (user.phone) sendSMS(user.phone, 'welcomeRider', [user.name]).catch(() => {});
    }

    res.status(201).json({
      token: signToken(user._id),
      user: { _id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/register-restaurant — restaurant partner application
router.post('/register-restaurant', async (req, res) => {
  try {
    const {
      ownerName, email, password, phone,
      restaurantName, cuisineType, address, description,
    } = req.body;

    if (!ownerName || !email || !password || !phone || !restaurantName || !cuisineType || !address)
      return res.status(400).json({ message: 'All fields are required' });

    if (await User.findOne({ email }))
      return res.status(400).json({ message: 'Email already registered' });

    const user = await User.create({
      name: ownerName,
      email,
      password,
      phone,
      role: 'restaurant',
    });

    await Restaurant.create({
      owner: user._id,
      name: restaurantName,
      cuisineType,
      address,
      description: description || '',
      phone,
      isVerified: false,
      isSuspended: false,
      isOpen: false,
    });

    // ── Notify applicant their application was received (non-blocking) ────────
    sendEmail(user.email, 'restaurantApplicationReceived', {
      ownerName,
      restaurantName,
    }).catch(() => {});
    if (phone) sendSMS(phone, 'restaurantApplicationReceived', [restaurantName]).catch(() => {});

    res.status(201).json({
      message: 'Application submitted! We will review and activate your restaurant within 24 hours.',
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await user.matchPassword(password)))
      return res.status(401).json({ message: 'Invalid email or password' });

    if (user.isSuspended)
      return res.status(403).json({ message: 'Account suspended. Contact support.' });

    if (user.role === 'restaurant') {
      const restaurant = await Restaurant.findOne({ owner: user._id });
      if (restaurant && !restaurant.isVerified) {
        return res.status(403).json({
          message: 'Your restaurant is pending approval. We will notify you within 24 hours.',
        });
      }
    }

    res.json({
      token: signToken(user._id),
      user: { _id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;