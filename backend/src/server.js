import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_me_secret';
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/var/lib/destichting/uploads';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = Date.now() + '-' + file.originalname.replace(/[^\w.\-]/g, '_');
    cb(null, safe);
  }
});
const upload = multer({ storage });

function authRequired(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: 'No token' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

function adminOnly(req, res, next) {
  if (req?.user?.role !== 'ADMIN') return res.status(403).json({ message: 'Admin only' });
  next();
}

// Authentication
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'Provide username and password' });
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ message: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      mustChangePassword: user.mustChangePassword
    }
  });
});

app.get('/api/auth/me', authRequired, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  res.json({
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    mustChangePassword: user.mustChangePassword
  });
});

app.post('/api/auth/change-password', authRequired, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ message: 'Password too short' });
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: req.user.id },
    data: { passwordHash, mustChangePassword: false }
  });
  res.json({ ok: true });
});

// Users (admin)
app.get('/api/users', authRequired, adminOnly, async (req, res) => {
  const users = await prisma.user.findMany({ orderBy: { id: 'asc' } });
  res.json(users);
});

app.post('/api/users', authRequired, adminOnly, async (req, res) => {
  const { username, firstName, tussenvoegsel, lastName, phone, role, specialNotes } = req.body;
  const passwordHash = await bcrypt.hash('1234', 10);
  const u = await prisma.user.create({
    data: { username, firstName, tussenvoegsel, lastName, phone, role: role || 'USER', passwordHash, mustChangePassword: true, specialNotes }
  });
  res.json(u);
});

app.put('/api/users/:id', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (req.user.role !== 'ADMIN' && req.user.id !== id) return res.status(403).json({ message: 'Forbidden' });
  const { username, firstName, tussenvoegsel, lastName, phone, role, specialNotes } = req.body;
  const u = await prisma.user.update({ where: { id }, data: { username, firstName, tussenvoegsel, lastName, phone, role, specialNotes } });
  res.json(u);
});

app.post('/api/users/:id/reset-password', authRequired, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const passwordHash = await bcrypt.hash('1234', 10);
  const u = await prisma.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } });
  res.json({ ok: true });
});

// Uitjes endpoints
app.get('/api/uitjes', async (req, res) => {
  const list = await prisma.uitje.findMany({
    where: { showOnFrontend: true },
    orderBy: [{ date: 'desc' }],
    select: { id: true, date: true, title: true, description: true, imageUrl: true, published: true, showOnFrontend: true }
  });
  res.json(list);
});

app.get('/api/uitjes/admin', authRequired, adminOnly, async (req, res) => {
  const list = await prisma.uitje.findMany({
    orderBy: [{ date: 'desc' }],
    include: { participants: true }
  });
  res.json(list);
});

app.get('/api/uitjes/:id', async (req, res) => {
  const id = Number(req.params.id);
  const u = await prisma.uitje.findUnique({
    where: { id },
    include: { events: true, meals: true, travels: true, participants: { include: { user: true } } }
  });
  if (!u) return res.status(404).json({ message: 'Not found' });
  res.json(u);
});

app.post('/api/uitjes', authRequired, adminOnly, async (req, res) => {
  const u = await prisma.uitje.create({ data: req.body });
  res.json(u);
});

app.put('/api/uitjes/:id', authRequired, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const u = await prisma.uitje.update({ where: { id }, data: req.body });
  res.json(u);
});

app.delete('/api/uitjes/:id', authRequired, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  await prisma.uitje.delete({ where: { id } });
  res.json({ ok: true });
});

// enrol & cancel
app.post('/api/uitjes/:id/enrol', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const p = await prisma.uitjeParticipant.upsert({
      where: { uitjeId_userId: { uitjeId: id, userId: req.user.id } },
      update: { status: 'GOING' },
      create: { uitjeId: id, userId: req.user.id, status: 'GOING' }
    });
    res.json(p);
  } catch (e) {
    res.status(400).json({ message: 'Already enrolled?' });
  }
});

app.post('/api/uitjes/:id/cancel', authRequired, async (req, res) => {
  const id = Number(req.params.id);
  const part = await prisma.uitjeParticipant.findUnique({ where: { uitjeId_userId: { uitjeId: id, userId: req.user.id } } });
  if (!part?.canCancel) return res.status(400).json({ message: 'Cancel not allowed (once only). Contact admin.)' });
  const p = await prisma.uitjeParticipant.update({
    where: { uitjeId_userId: { uitjeId: id, userId: req.user.id } },
    data: { status: 'CANCELED', canCancel: false }
  });
  res.json(p);
});

app.post('/api/uitjes/:id/reset-cancel/:userId', authRequired, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const userId = Number(req.params.userId);
  const p = await prisma.uitjeParticipant.update({
    where: { uitjeId_userId: { uitjeId: id, userId } },
    data: { canCancel: true, status: 'GOING' }
  });
  res.json(p);
});

app.post('/api/uitjes/:id/payflags/:userId', authRequired, adminOnly, async (req, res) => {
  const { prepaid, postpaid } = req.body;
  const updated = await prisma.uitjeParticipant.update({
    where: { uitjeId_userId: { uitjeId: Number(req.params.id), userId: Number(req.params.userId) } },
    data: { prepaid: !!prepaid, postpaid: !!postpaid }
  });
  res.json(updated);
});

// uploads
app.post('/api/upload', authRequired, upload.single('file'), async (req, res) => {
  const file = req.file;
  const up = await prisma.upload.create({
    data: {
      userId: req.user.id,
      path: file.filename,
      original: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    }
  });
  res.json({ ok: true, file: up });
});

app.get('/api/uploads/:filename', async (req, res) => {
  const filename = req.params.filename.replace(/[^-\w.]/g, '');
  const p = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.sendFile(p);
});

// settings
app.get('/api/settings', async (req, res) => {
  const s = await prisma.setting.findUnique({ where: { id: 1 } });
  res.json(s);
});

app.put('/api/settings', authRequired, adminOnly, async (req, res) => {
  const s = await prisma.setting.update({ where: { id: 1 }, data: req.body });
  res.json(s);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Backend listening on ${PORT}`);
});
