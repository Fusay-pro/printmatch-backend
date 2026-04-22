require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

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
app.use(cookieParser());
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
const pool = require('./db/pool');

// Verify JWT on handshake — reject unauthenticated connections
io.use((socket, next) => {
  let token = socket.handshake.auth?.token;
  if (!token) {
    // Fall back to cookie if frontend sends credentials: true
    const raw = socket.handshake.headers.cookie || '';
    const match = raw.match(/(?:^|;\s*)token=([^;]+)/);
    if (match) token = match[1];
  }
  if (!token) return next(new Error('Authentication required'));
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  onlineUsers.set(userId, socket.id);
  socket.userId = userId;
  console.log(`User ${userId} online (socket ${socket.id})`);

  // join — now a no-op for identity (already resolved from JWT); kept for back-compat
  socket.on('join', () => {});

  // Join a job room — verify the user is actually a participant
  socket.on('join_job', async (jobId) => {
    try {
      const result = await pool.query(
        `SELECT j.commissioner_id, pp.user_id AS printer_user_id
         FROM jobs j
         LEFT JOIN printer_profiles pp ON pp.id = j.assigned_printer_id
         WHERE j.id = $1`,
        [jobId]
      );
      const job = result.rows[0];
      if (!job) return;
      if (job.commissioner_id === userId || job.printer_user_id === userId) {
        socket.join(`job:${jobId}`);
      }
    } catch { /* ignore bad jobId */ }
  });

  // New chat message — sender identity comes from verified token
  socket.on('send_message', (data) => {
    // data: { job_id, sender_name, content }
    io.to(`job:${data.job_id}`).emit('new_message', {
      job_id: data.job_id,
      sender_id: userId,          // server-authoritative
      sender_name: data.sender_name,
      content: data.content,
      created_at: new Date(),
    });
  });

  // Progress update — notify commissioner in real time
  socket.on('progress_update', async (data) => {
    // data: { job_id, percent_complete, message }
    try {
      const result = await pool.query(
        `SELECT j.commissioner_id FROM jobs j
         JOIN printer_profiles pp ON pp.id = j.assigned_printer_id
         WHERE j.id = $1 AND pp.user_id = $2`,
        [data.job_id, userId]
      );
      if (!result.rows.length) return; // not the assigned printer
      const { commissioner_id } = result.rows[0];
      io.to(`job:${data.job_id}`).emit('new_progress', {
        job_id: data.job_id,
        percent_complete: data.percent_complete,
        message: data.message,
      });
      const commSocket = onlineUsers.get(commissioner_id);
      if (commSocket) {
        io.to(commSocket).emit('notification', {
          type: 'progress',
          job_id: data.job_id,
          message: `Your print is ${data.percent_complete}% complete`,
        });
      }
    } catch { /* ignore */ }
  });

  // Job status change — verify sender is assigned printer
  socket.on('job_status_change', async (data) => {
    // data: { job_id, new_status }
    try {
      const result = await pool.query(
        `SELECT j.commissioner_id FROM jobs j
         JOIN printer_profiles pp ON pp.id = j.assigned_printer_id
         WHERE j.id = $1 AND pp.user_id = $2`,
        [data.job_id, userId]
      );
      if (!result.rows.length) return;
      const { commissioner_id } = result.rows[0];
      const commSocket = onlineUsers.get(commissioner_id);
      if (commSocket) {
        io.to(commSocket).emit('notification', {
          type: 'status',
          job_id: data.job_id,
          message: `Your job status changed to: ${data.new_status}`,
          new_status: data.new_status,
        });
      }
      io.to(`job:${data.job_id}`).emit('status_updated', {
        job_id: data.job_id,
        new_status: data.new_status,
      });
    } catch { /* ignore */ }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(userId);
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
