// const router = require('express').Router();
// const jwt = require('jsonwebtoken');
// const { User, Restaurant } = require('../models');
// const { sendEmail } = require('../utils/emailService');
// const { sendSMS } = require('../utils/smsService');
// const axios = require('axios');
// const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });

// // POST /api/auth/register — customer & rider
// router.post('/register', async (req, res) => {
//   try {
//     const {
//       name, email, password, phone, role, vehicleType,
//       restaurantName,
//       ninNumber, idType, idDocumentUrl, // ← NEW rider verification fields
//     } = req.body;

//     if (await User.findOne({ email }))
//       return res.status(400).json({ message: 'Email already registered' });

//     // Riders must provide NIN/ID
//     if (role === 'rider') {
//       if (!ninNumber || !ninNumber.trim())
//         return res.status(400).json({ message: 'Please provide your NIN or ID number' });
//       if (!phone || !phone.trim())
//         return res.status(400).json({ message: 'Phone number is required for riders' });
//     }

//     const user = await User.create({
//       name, email, password, phone,
//       role: role || 'customer',
//       vehicleType,
//       // Rider verification fields
//       ninNumber: ninNumber || '',
//       idType: idType || 'NIN',
//       idDocumentUrl: idDocumentUrl || '',
//       // Riders start as NOT approved — admin must approve
//       isApproved: role === 'rider' ? false : true,
//     });

//     if (role === 'restaurant') {
//       await Restaurant.create({
//         owner: user._id,
//         name: restaurantName || name + "'s Restaurant",
//         phone,
//         isVerified: true,
//       });
//     }

//     // ── Welcome notifications ─────────────────────────────────────────────────
//     if (user.role === 'customer') {
//       sendEmail(user.email, 'welcomeCustomer', user.name).catch(() => {});
//       if (user.phone) sendSMS(user.phone, 'welcomeCustomer', [user.name]).catch(() => {});
//     }

//     if (user.role === 'rider') {
//       sendEmail(user.email, 'welcomeRider', user.name).catch(() => {});
//       if (user.phone) sendSMS(user.phone, 'welcomeRider', [user.name]).catch(() => {});
//       // Return pending message — no token yet
//       return res.status(201).json({
//         pending: true,
//         message: 'Application submitted! Your account is under review. We will notify you once approved.',
//       });
//     }

//     res.status(201).json({
//       token: signToken(user._id),
//       user: { _id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone },
//     });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// });

// // POST /api/auth/register-restaurant — restaurant partner application
// router.post('/register-restaurant', async (req, res) => {
//   try {
//     const {
//       ownerName, email, password, phone,
//       restaurantName, cuisineType, address, description,
//     } = req.body;

//     if (!ownerName || !email || !password || !phone || !restaurantName || !cuisineType || !address)
//       return res.status(400).json({ message: 'All fields are required' });

//     if (await User.findOne({ email }))
//       return res.status(400).json({ message: 'Email already registered' });

//     const user = await User.create({
//       name: ownerName, email, password, phone, role: 'restaurant', isApproved: true,
//     });

//     await Restaurant.create({
//       owner: user._id, name: restaurantName, cuisineType,
//       address, description: description || '', phone,
//       isVerified: false, isSuspended: false, isOpen: false,
//     });

//     sendEmail(user.email, 'restaurantApplicationReceived', { ownerName, restaurantName }).catch(() => {});
//     if (phone) sendSMS(phone, 'restaurantApplicationReceived', [restaurantName]).catch(() => {});

//     res.status(201).json({
//       message: 'Application submitted! We will review and activate your restaurant within 24 hours.',
//     });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// });





// // ── ADD THIS TO backend/src/routes/auth.js ────────────────────────────────────
// // Add after the existing POST /login route, before module.exports



// // POST /api/auth/google — Google Sign-In (create or login)
// router.post('/google', async (req, res) => {
//   try {
//     const { idToken, accessToken } = req.body;

//     if (!idToken && !accessToken) {
//       return res.status(400).json({ message: 'Google token required' });
//     }

//     // ── Verify token and get user info from Google ────────────────────────────
//     let googleUser;
//     try {
//       if (accessToken) {
//         // Use access token to get user info
//         const response = await axios.get(
//           `https://www.googleapis.com/oauth2/v3/userinfo`,
//           { headers: { Authorization: `Bearer ${accessToken}` } }
//         );
//         googleUser = response.data;
//       } else {
//         // Verify ID token
//         const response = await axios.get(
//           `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
//         );
//         googleUser = response.data;
//       }
//     } catch (err) {
//       return res.status(401).json({ message: 'Invalid Google token' });
//     }

//     const { email, name, sub: googleId, picture } = googleUser;

//     if (!email) {
//       return res.status(400).json({ message: 'Could not get email from Google' });
//     }

//     // ── Find existing user or create new one ──────────────────────────────────
//     let user = await User.findOne({ email: email.toLowerCase() });

//     if (user) {
//       // User exists — check if suspended
//       if (user.isSuspended) {
//         return res.status(403).json({ message: 'Account suspended. Contact support.' });
//       }
//       // Update googleId if not set
//       if (!user.googleId) {
//         await User.findByIdAndUpdate(user._id, { googleId });
//       }
//     } else {
//       // New user — create account automatically
//       user = await User.create({
//         name:      name || email.split('@')[0],
//         email:     email.toLowerCase(),
//         password:  googleId + process.env.JWT_SECRET, // random password they'll never use
//         role:      'customer',
//         googleId,
//         isApproved: true,
//         avatar:    picture || '',
//       });

//       // Send welcome email
//       sendEmail(user.email, 'welcomeCustomer', user.name).catch(() => {});
//     }

//     res.json({
//       token: signToken(user._id),
//       user: {
//         _id:   user._id,
//         name:  user.name,
//         email: user.email,
//         role:  user.role,
//         phone: user.phone,
//       },
//     });
//   } catch (err) {
//     console.error('Google auth error:', err.message);
//     res.status(500).json({ message: err.message });
//   }
// });

// // POST /api/auth/login
// router.post('/login', async (req, res) => {
//   try {
//     const { email, password } = req.body;
//     const user = await User.findOne({ email });

//     if (!user || !(await user.matchPassword(password)))
//       return res.status(401).json({ message: 'Invalid email or password' });

//     if (user.isSuspended)
//       return res.status(403).json({ message: 'Account suspended. Contact support.' });

//     // ── Block unapproved riders ───────────────────────────────────────────────
//     if (user.role === 'rider' && !user.isApproved) {
//       if (user.rejectionReason) {
//         return res.status(403).json({
//           message: `Your application was rejected: ${user.rejectionReason}. Contact support@doorbite.ng`,
//           rejected: true,
//         });
//       }
//       return res.status(403).json({
//         message: 'Your rider account is pending approval. We will notify you once reviewed.',
//         pending: true,
//       });
//     }

//     if (user.role === 'restaurant') {
//       const restaurant = await Restaurant.findOne({ owner: user._id });
//       if (restaurant && !restaurant.isVerified) {
//         return res.status(403).json({
//           message: 'Your restaurant is pending approval. We will notify you within 24 hours.',
//         });
//       }
//     }

//     res.json({
//       token: signToken(user._id),
//       user: { _id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone },
//     });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// });

// module.exports = router;


const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { User, Restaurant } = require('../models');
const { sendEmail } = require('../utils/emailService');
const { sendSMS } = require('../utils/smsService');
const axios = require('axios');

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });

// ── Generate 6-digit OTP ──────────────────────────────────────────────────────
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// ── POST /api/auth/register — customer & rider ────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const {
      name, email, password, phone, role, vehicleType,
      restaurantName, ninNumber, idType, idDocumentUrl,
    } = req.body;

    if (await User.findOne({ email }))
      return res.status(400).json({ message: 'Email already registered' });

    if (role === 'rider') {
      if (!ninNumber || !ninNumber.trim())
        return res.status(400).json({ message: 'Please provide your NIN or ID number' });
      if (!phone || !phone.trim())
        return res.status(400).json({ message: 'Phone number is required for riders' });
    }

    // ── Generate OTP for customers ────────────────────────────────────────────
    const otp         = generateOTP();
    const otpExpires  = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const user = await User.create({
      name, email, password, phone,
      role: role || 'customer',
      vehicleType,
      ninNumber:      ninNumber || '',
      idType:         idType || 'NIN',
      idDocumentUrl:  idDocumentUrl || '',
      isApproved:     role === 'rider' ? false : true,
      // OTP fields — only used for customers
      emailOtp:         role === 'customer' ? otp       : '',
      emailOtpExpires:  role === 'customer' ? otpExpires : null,
      isEmailVerified:  role !== 'customer', // riders/restaurants skip OTP
    });

    if (role === 'restaurant') {
      await Restaurant.create({
        owner: user._id,
        name: restaurantName || name + "'s Restaurant",
        phone, isVerified: true,
      });
    }

    // ── Rider: pending approval, no OTP needed ────────────────────────────────
    if (user.role === 'rider') {
      sendEmail(user.email, 'welcomeRider', user.name).catch(() => {});
      if (user.phone) sendSMS(user.phone, 'welcomeRider', [user.name]).catch(() => {});
      return res.status(201).json({
        pending: true,
        message: 'Application submitted! Your account is under review.',
      });
    }

    // ── Customer: send OTP email ──────────────────────────────────────────────
    if (user.role === 'customer') {
      sendEmail(user.email, 'emailOtp', { name: user.name, otp }).catch(() => {});
      return res.status(201).json({
        otpRequired: true,
        userId: user._id,
        message: `We sent a 6-digit code to ${email}. Please verify your email to continue.`,
      });
    }

    res.status(201).json({
      token: signToken(user._id),
      user: { _id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/auth/verify-otp — verify email OTP ─────────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const { userId, otp } = req.body;
    if (!userId || !otp)
      return res.status(400).json({ message: 'userId and otp are required' });

    const user = await User.findById(userId);
    if (!user)
      return res.status(404).json({ message: 'User not found' });

    if (user.isEmailVerified)
      return res.json({
        token: signToken(user._id),
        user: { _id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone },
      });

    if (!user.emailOtp || user.emailOtp !== otp.toString().trim())
      return res.status(400).json({ message: 'Invalid OTP. Please check your email and try again.' });

    if (new Date() > user.emailOtpExpires)
      return res.status(400).json({ message: 'OTP expired. Please request a new one.', expired: true });

    // ── Mark verified, clear OTP ──────────────────────────────────────────────
    await User.findByIdAndUpdate(userId, {
      isEmailVerified: true,
      emailOtp:        '',
      emailOtpExpires: null,
    });

    // Send welcome email after verification
    sendEmail(user.email, 'welcomeCustomer', user.name).catch(() => {});
    if (user.phone) sendSMS(user.phone, 'welcomeCustomer', [user.name]).catch(() => {});

    res.json({
      token: signToken(user._id),
      user: { _id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/auth/resend-otp — resend OTP ───────────────────────────────────
router.post('/resend-otp', async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.isEmailVerified)
      return res.status(400).json({ message: 'Email already verified' });

    const otp        = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    await User.findByIdAndUpdate(userId, { emailOtp: otp, emailOtpExpires: otpExpires });
    sendEmail(user.email, 'emailOtp', { name: user.name, otp }).catch(() => {});

    res.json({ message: `New OTP sent to ${user.email}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/auth/register-restaurant ───────────────────────────────────────
router.post('/register-restaurant', async (req, res) => {
  try {
    const { ownerName, email, password, phone, restaurantName, cuisineType, address, description } = req.body;

    if (!ownerName || !email || !password || !phone || !restaurantName || !cuisineType || !address)
      return res.status(400).json({ message: 'All fields are required' });

    if (await User.findOne({ email }))
      return res.status(400).json({ message: 'Email already registered' });

    const user = await User.create({
      name: ownerName, email, password, phone, role: 'restaurant', isApproved: true, isEmailVerified: true,
    });

    await Restaurant.create({
      owner: user._id, name: restaurantName, cuisineType,
      address, description: description || '', phone,
      isVerified: false, isSuspended: false, isOpen: false,
    });

    sendEmail(user.email, 'restaurantApplicationReceived', { ownerName, restaurantName }).catch(() => {});
    if (phone) sendSMS(phone, 'restaurantApplicationReceived', [restaurantName]).catch(() => {});

    res.status(201).json({ message: 'Application submitted! We will review and activate your restaurant within 24 hours.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/auth/google ─────────────────────────────────────────────────────
router.post('/google', async (req, res) => {
  try {
    const { idToken, accessToken } = req.body;
    if (!idToken && !accessToken)
      return res.status(400).json({ message: 'Google token required' });

    let googleUser;
    try {
      if (accessToken) {
        const response = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        googleUser = response.data;
      } else {
        const response = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
        googleUser = response.data;
      }
    } catch {
      return res.status(401).json({ message: 'Invalid Google token' });
    }

    const { email, name, sub: googleId, picture } = googleUser;
    if (!email) return res.status(400).json({ message: 'Could not get email from Google' });

    let user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
      if (user.isSuspended) return res.status(403).json({ message: 'Account suspended. Contact support.' });
      if (!user.googleId) await User.findByIdAndUpdate(user._id, { googleId });
    } else {
      user = await User.create({
        name:            name || email.split('@')[0],
        email:           email.toLowerCase(),
        password:        googleId + process.env.JWT_SECRET,
        role:            'customer',
        googleId,
        isApproved:      true,
        isEmailVerified: true, // Google accounts are already verified
        avatar:          picture || '',
      });
      sendEmail(user.email, 'welcomeCustomer', user.name).catch(() => {});
    }

    res.json({
      token: signToken(user._id),
      user: { _id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone },
    });
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── ADD THESE 3 ROUTES to backend/src/routes/auth.js ─────────────────────────
// Paste them right before:  module.exports = router;

// ── POST /api/auth/forgot-password — send OTP to email ───────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    // Always return success to prevent email enumeration
    if (!user || user.role !== 'customer') {
      return res.json({ message: 'If that email exists, a reset code has been sent.' });
    }

    const otp        = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await User.findByIdAndUpdate(user._id, {
      emailOtp:        otp,
      emailOtpExpires: otpExpires,
    });

    sendEmail(user.email, 'forgotPassword', { name: user.name, otp }).catch(() => {});

    res.json({
      success:  true,
      userId:   user._id,
      message:  'A password reset code has been sent to your email.',
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/auth/verify-reset-otp — verify OTP before allowing reset ───────
router.post('/verify-reset-otp', async (req, res) => {
  try {
    const { userId, otp } = req.body;
    if (!userId || !otp) return res.status(400).json({ message: 'userId and otp are required' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.emailOtp || user.emailOtp !== otp.toString().trim())
      return res.status(400).json({ message: 'Invalid code. Please check your email and try again.' });

    if (new Date() > user.emailOtpExpires)
      return res.status(400).json({ message: 'Code expired. Please request a new one.', expired: true });

    // Generate a short-lived reset token (5 minutes)
    const resetToken = jwt.sign(
      { id: user._id, purpose: 'reset' },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );

    // Clear OTP
    await User.findByIdAndUpdate(userId, { emailOtp: '', emailOtpExpires: null });

    res.json({ resetToken, message: 'OTP verified. You can now set a new password.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/auth/reset-password — set new password using reset token ────────
router.post('/reset-password', async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword)
      return res.status(400).json({ message: 'Reset token and new password are required' });

    if (newPassword.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters' });

    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ message: 'Reset link expired. Please start over.' });
    }

    if (decoded.purpose !== 'reset')
      return res.status(401).json({ message: 'Invalid reset token' });

    const user = await User.findById(decoded.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.password = newPassword; // model's pre-save hook hashes it
    await user.save();

    res.json({
      token: signToken(user._id),
      user:  { _id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone },
      message: 'Password reset successful!',
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await user.matchPassword(password)))
      return res.status(401).json({ message: 'Invalid email or password' });

    if (user.isSuspended)
      return res.status(403).json({ message: 'Account suspended. Contact support.' });

    // ── If customer hasn't verified email yet, resend OTP ─────────────────────
    if (user.role === 'customer' && !user.isEmailVerified) {
      const otp        = generateOTP();
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
      await User.findByIdAndUpdate(user._id, { emailOtp: otp, emailOtpExpires: otpExpires });
      sendEmail(user.email, 'emailOtp', { name: user.name, otp }).catch(() => {});
      return res.status(403).json({
        otpRequired: true,
        userId: user._id,
        message: 'Please verify your email. We sent a new OTP to ' + email,
      });
    }

    if (user.role === 'rider' && !user.isApproved) {
      if (user.rejectionReason) {
        return res.status(403).json({
          message: `Your application was rejected: ${user.rejectionReason}. Contact support@doorbite.ng`,
          rejected: true,
        });
      }
      return res.status(403).json({
        message: 'Your rider account is pending approval. We will notify you once reviewed.',
        pending: true,
      });
    }

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
      user: { _id: user._id, name: user.name, email: user.email, role: user.role, phone: user.phone },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;