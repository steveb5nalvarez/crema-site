// server.js — CREMA minimal backend
// - Sirve la SPA y assets
// - Healthcheck
// - Admin: crear empleado (Auth + profiles + employees) usando Service Key

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ==== ENV requeridas ====
// SUPABASE_URL
// SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_SERVICE_ROLE)
// (opcional) PUBLIC_DIR (default: ./public)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan variables de entorno: SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE');
  process.exit(1);
}

// Cliente admin (service role) — no persistimos sesión en server
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// No cache en HTML (útil para auth)
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  next();
});

// Servir estáticos
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// Healthcheck
app.get('/healthz', (_, res) => res.status(200).send('ok'));

// Debug ENV (temporal)
app.get('/debug-env', (req, res) => {
  res.json({
    SUPABASE_URL: process.env.SUPABASE_URL || null,
    SERVICE_KEY_PRESENT: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE),
    PUBLIC_DIR: PUBLIC_DIR
  });
});

// =====================================================
// Auth helper: verifica token de Supabase y rol = manager
// El front debe enviar Authorization: Bearer <supabase access token>
// =====================================================
async function requireManager(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).send('Missing Authorization Bearer token');

    // Valida el access token y obtiene el user
    const { data: udata, error: uerr } = await admin.auth.getUser(token);
    if (uerr || !udata?.user) return res.status(401).send('Invalid token');

    const user = udata.user;

    // Chequea el rol en profiles
    const { data: prof, error: perr } = await admin
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (perr || !prof || prof.role !== 'manager') return res.status(403).send('Not a manager');

    // adjuntamos al request por si se necesitara
    req.user = user;
    return next();
  } catch (e) {
    console.error(e);
    return res.status(500).send('Auth check failed');
  }
}

// =====================================================
// ADMIN: crear empleado
// Crea usuario en Auth, pone profile = dipendente, inserta fila en employees
// Body: { fullName, email, password, role, department }
// =====================================================
app.post('/api/admin/create-employee', requireManager, async (req, res) => {
  try {
    const { fullName, email, password, role, department } = req.body || {};
    if (!fullName || !email || !password) {
      return res.status(400).send('fullName, email, password sono obbligatori');
    }

    // 1) Crea usuario en Auth
    const { data: created, error: aErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: fullName }
    });
    if (aErr) return res.status(400).send(aErr.message);

    const userId = created.user.id;

    // 2) Upsert profile (role = dipendente)
    const { error: pErr } = await admin.from('profiles').upsert({
      user_id: userId,
      full_name: fullName,
      role: 'dipendente'
    });
    if (pErr) return res.status(400).send(pErr.message);

    // 3) Inserta en employees
    const { error: eErr } = await admin.from('employees').insert({
      user_id: userId,
      name: fullName,
      role: role || null,
      department: department || null,
      is_active: true
    });
    if (eErr) return res.status(400).send(eErr.message);

    return res.json({ ok: true, user_id: userId });
  } catch (e) {
    console.error(e);
    return res.status(500).send(e.message || 'Server error');
  }
});

// ===== Fallback SPA compatible con Express 5 (sin '*') =====
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Start
app.listen(PORT, () => console.log(`CREMA server listo en http://localhost:${PORT}`));
