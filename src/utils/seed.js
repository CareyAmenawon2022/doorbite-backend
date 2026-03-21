const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const connectDB = require('./db');
const { User } = require('../models');

async function seed() {
  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI not found. Check your .env file in the backend folder.');
    process.exit(1);
  }

  await connectDB();
  
  const existing = await User.findOne({ email: 'admin@quickbite.ng' });
  if (!existing) {
    await User.create({
      name: 'Super Admin',
      email: 'admin@quickbite.ng',
      password: 'admin123',
      role: 'admin',
    });
    console.log('✅ Admin created: admin@quickbite.ng / admin123');
  } else {
    console.log('ℹ️  Admin already exists');
  }

  process.exit(0);
}

seed().catch(console.error);