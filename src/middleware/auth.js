const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  // Accept token from HttpOnly cookie or Bearer header
  const token = req.cookies?.token || (() => {
    const h = req.headers.authorization;
    return h?.startsWith('Bearer ') ? h.split(' ')[1] : null;
  })();
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports = auth;
