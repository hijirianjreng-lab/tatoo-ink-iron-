// ink-studio/middleware/adminAuth.js
import crypto from 'crypto';

const sessions = new Map(); // token -> expiry

export function adminLogin(req, res) {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  const expected = (process.env.ADMIN_TOKEN_HASH || '').trim();
  const received = crypto.createHash('sha256').update(token.trim()).digest('hex');

  // Debug log so we can see exactly what is happening in Render Logs
  console.log('--- LOGIN ATTEMPT ---');
  console.log('Typed Token:', token.trim());
  console.log('Generated Hash:', received);
  console.log('Expected Hash (from ENV):', expected);

  // Simple string comparison
  if (received !== expected) {
    console.log('❌ Token Mismatch');
    return res.status(401).json({ error: 'Invalid token' });
  }

  console.log('✅ Token Match!');
  const sessionId = crypto.randomBytes(32).toString('hex');
  const ttl = parseInt(process.env.SESSION_TTL_MINUTES || '30') * 60 * 1000;
  sessions.set(sessionId, Date.now() + ttl);
  
  res.json({ sessionId, expiresInMinutes: ttl / 60000 });
}

export function requireAdmin(req, res, next) {
  const sid = req.headers['x-admin-session'];
  const exp = sessions.get(sid);
  if (!exp || exp < Date.now()) {
    sessions.delete(sid);
    return res.status(401).json({ error: 'Session expired' });
  }
  sessions.set(sid, Date.now() + 30 * 60 * 1000); // sliding window
  next();
}
