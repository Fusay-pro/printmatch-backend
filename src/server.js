require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const jobRoutes = require('./routes/jobs');
const printerRoutes = require('./routes/printers');
const miscRoutes = require('./routes/misc');
const uploadRoutes = require('./routes/upload');
const adminRoutes = require('./routes/admin');
const appealRoutes = require('./routes/appeals');
const conversationRoutes = require('./routes/conversations');
const reportRoutes = require('./routes/reports');
const portfolioRoutes = require('./routes/portfolio');

const app = express();
const server = http.createServer(app);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:5173'];

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
});

// Middleware
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/printers', printerRoutes);
app.use('/api', miscRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/appeals', appealRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/portfolio', portfolioRoutes);

// ─── SOCKET.IO — real-time chat + notifications ───────────────────────────────
const onlineUsers = new Map(); // userId -> socketId

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // User joins with their userId
  socket.on('join', (userId) => {
    onlineUsers.set(userId, socket.id);
    socket.userId = userId;
    console.log(`User ${userId} online`);
  });

  // Join a job room for job-specific updates
  socket.on('join_job', (jobId) => {
    socket.join(`job:${jobId}`);
  });

  // New chat message — broadcast to job room
  socket.on('send_message', (data) => {
    // data: { job_id, sender_id, sender_name, content }
    io.to(`job:${data.job_id}`).emit('new_message', {
      ...data,
      created_at: new Date(),
    });
  });

  // Progress update — notify commissioner in real time
  socket.on('progress_update', (data) => {
    // data: { job_id, commissioner_id, percent_complete, message }
    io.to(`job:${data.job_id}`).emit('new_progress', data);

    // Also push to commissioner directly if online
    const commSocket = onlineUsers.get(data.commissioner_id);
    if (commSocket) {
      io.to(commSocket).emit('notification', {
        type: 'progress',
        job_id: data.job_id,
        message: `Your print is ${data.percent_complete}% complete`,
      });
    }
  });

  // Job status change — notify relevant users
  socket.on('job_status_change', (data) => {
    // data: { job_id, commissioner_id, new_status }
    const commSocket = onlineUsers.get(data.commissioner_id);
    if (commSocket) {
      io.to(commSocket).emit('notification', {
        type: 'status',
        job_id: data.job_id,
        message: `Your job status changed to: ${data.new_status}`,
        new_status: data.new_status,
      });
    }
    io.to(`job:${data.job_id}`).emit('status_updated', data);
  });

  socket.on('disconnect', () => {
    if (socket.userId) onlineUsers.delete(socket.userId);
    console.log('Socket disconnected:', socket.id);
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`PrintMatch API running on port ${PORT}`);
});

module.exports = { app, io };
