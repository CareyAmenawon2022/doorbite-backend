require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const connectDB = require('./utils/db');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
});

app.set('io', io);
app.use(cors());
app.use(express.json());

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/restaurants', require('./routes/restaurants'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/riders', require('./routes/riders'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/withdrawals', require('./routes/withdrawals'));
app.use('/api/refunds', require('./routes/refunds'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/promotions', require('./routes/allRoutes').promotionsRouter);
app.use('/api/categories', require('./routes/allRoutes').categoriesRouter);

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// ── SOCKET.IO ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  socket.on('join', (userId) => {
    socket.join(`user:${userId}`);
    console.log(`User ${userId} joined their room`);
  });

  socket.on('restaurant:join', (restaurantId) => {
    socket.join(`restaurant:${restaurantId}`);
    console.log(`Restaurant ${restaurantId} online`);
  });

  socket.on('rider:join', (riderId) => {
    socket.join(`rider:${riderId}`);
  });

  socket.on('rider:location', ({ orderId, lat, lng }) => {
    if (orderId) io.to(`order:${orderId}`).emit('rider:location', { lat, lng });
  });

  socket.on('order:subscribe', (orderId) => {
    socket.join(`order:${orderId}`);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
connectDB().then(() => {
  server.listen(PORT, () => console.log(`✅ DoorBite API running on port ${PORT}`));
});