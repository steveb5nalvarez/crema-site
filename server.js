// server.js — CREMA backend (Supabase)
// - Sirve SPA/estáticos
// - Healthcheck y debug
// - Auth por Supabase access token (Bearer)
// - Endpoints: perfil, empleados, horas mensili (RPC), turni (CRUD manager), alta empleado (manager)

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

// ==== ENV ====
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_SERVICE_ROLE)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan variables: SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE');
  process.exit(1);
}

// Cliente admin (service role) — no persistimos sesión en server
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ==== Middlewares base ====
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// No cache en HTML (útil para auth/SPA)
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  next();
});

// Estáticos
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// ==== Salud / debug ====
app.get('/healthz', (_, res) => res.status(200).send('ok'));

app.get('/debug-env', (req, res) => {
  res.json({
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SERVICE_KEY_PRESENT: !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE),
    PUBLIC_DIR
  });
});

// ==== Auth helpers ====
// Lee access token de Supabase y retorna user + profile (o lanza)
async function getAuthContext(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw Object.assign(new Error('Missing Authorization Bearer token'), { status: 401 });

  // valida token
  const { data: udata, error: uerr } = await admin.auth.getUser(token);
  if (uerr || !udata?.user) throw Object.assign(new Error('Invalid token'), { status: 401 });
  const user = udata.user;

  // obtiene perfil (rol)
  const { data: profile, error: perr } = await admin
    .from('profiles')
    .select('user_id, full_name, role, avatar_url')
    .eq('user_id', user.id)
    .single();
  if (perr || !profile) throw Object.assign(new Error('Profile not found'), { status: 403 });

  return { token, user, profile };
}

async function requireAuth(req, res, next) {
  try {
    req.ctx = await getAuthContext(req);
    next();
  } catch (e) {
    res.status(e.status || 500).send(e.message || 'Auth error');
  }
}

async function requireManager(req, res, next) {
  try {
    req.ctx = await getAuthContext(req);
    if (req.ctx.profile.role !== 'manager') {
      return res.status(403).send('Not a manager');
    }
    next();
  } catch (e) {
    res.status(e.status || 500).send(e.message || 'Auth error');
  }
}

// ==== /api/me ====
// Devuelve { user, profile } del token actual
app.get('/api/me', requireAuth, async (req, res) => {
  const { user, profile } = req.ctx;
  res.json({ user: { id: user.id, email: user.email }, profile });
});

// ==== ADMIN: crear empleado ====
// Body: { fullName, email, password, role, department }
// Crea user Auth, profile=dipendente y fila en employees (activo)
app.post('/api/admin/create-employee', requireManager, async (req, res) => {
  try {
    const { fullName, email, password, role, department } = req.body || {};
    if (!fullName || !email || !password) {
      return res.status(400).send('fullName, email, password sono obbligatori');
    }

    // 1) Auth user
    const { data: created, error: aErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: fullName }
    });
    if (aErr) return res.status(400).send(aErr.message);
    const userId = created.user.id;

    // 2) profile
    const { error: pErr } = await admin.from('profiles').upsert({
      user_id: userId,
      full_name: fullName,
      role: 'dipendente'
    });
    if (pErr) return res.status(400).send(pErr.message);

    // 3) employees
    const { error: eErr } = await admin.from('employees').insert({
      user_id: userId,
      name: fullName,
      role: role || null,
      department: department || null,
      is_active: true
    });
    if (eErr) return res.status(400).send(eErr.message);

    res.json({ ok: true, user_id: userId });
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message || 'Server error');
  }
});

// ==== EMPLOYEES ====

// GET /api/employees  → lista empleados activos
app.get('/api/employees', requireAuth, async (req, res) => {
  try {
    const { data, error } = await admin
      .from('employees')
      .select('id, user_id, name, role, department, is_active, created_at')
      .eq('is_active', true)
      .order('name', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).send(e.message || 'Error fetching employees');
  }
});

// GET /api/employees/hours?from=YYYY-MM-DD&to=YYYY-MM-DD
// Usa RPC get_hours_by_employee (debes tenerla creada)
app.get('/api/employees/hours', requireAuth, async (req, res) => {
  try {
    const from = req.query.from;
    const to = req.query.to;
    if (!from || !to) return res.status(400).send('Parámetros "from" y "to" requeridos (YYYY-MM-DD)');
    const { data, error } = await admin.rpc('get_hours_by_employee', { _from: from, _to: to });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).send(e.message || 'Error fetching hours');
  }
});

// ==== SHIFTS ====

// GET /api/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD&employee_id=#
app.get('/api/shifts', requireAuth, async (req, res) => {
  try {
    const { from, to, employee_id } = req.query;
    let q = admin
      .from('shifts')
      .select('id, employee_id, date, start_time, end_time, break_minutes, break_paid, off, notes')
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });

    if (from) q = q.gte('date', from);
    if (to)   q = q.lte('date', to);
    if (employee_id) q = q.eq('employee_id', employee_id);

    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).send(e.message || 'Error fetching shifts');
  }
});

// POST /api/shifts  (solo manager)
// Body: { employee_id, date, off?, start_time?, end_time?, break_minutes?, break_paid?, notes? }
app.post('/api/shifts', requireManager, async (req, res) => {
  try {
    const { employee_id, date, off=false, start_time=null, end_time=null, break_minutes=0, break_paid=false, notes=null } = req.body || {};
    if (!employee_id || !date) return res.status(400).send('employee_id y date son obligatorios');

    // si es OFF: guardamos un registro OFF y tiempos nulos
    if (off) {
      const { data, error } = await admin
        .from('shifts')
        .insert({ employee_id, date, off: true, start_time: null, end_time: null, break_minutes: 0, break_paid: false, notes });
      if (error) throw error;
      return res.json(data?.[0] || { ok: true });
    }

    if (!start_time || !end_time) return res.status(400).send('start_time y end_time requeridos cuando off=false');

    // (opcional) validación de solape básico
    const { data: conflict, error: errOverlap } = await admin
      .from('shifts')
      .select('id')
      .eq('employee_id', employee_id)
      .eq('date', date)
      .lt('start_time', end_time)
      .gt('end_time', start_time)
      .limit(1);
    if (errOverlap) throw errOverlap;
    if (conflict && conflict.length) return res.status(409).send('Turno sovrapposto per lo stesso dipendente');

    const { data, error } = await admin
      .from('shifts')
      .insert({ employee_id, date, start_time, end_time, break_minutes, break_paid, off: false, notes })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).send(e.message || 'Error creating shift');
  }
});

// PUT /api/shifts/:id  (solo manager)
app.put('/api/shifts/:id', requireManager, async (req, res) => {
  try {
    const id = req.params.id;
    const { employee_id, date, off=false, start_time=null, end_time=null, break_minutes=0, break_paid=false, notes=null } = req.body || {};
    if (!employee_id || !date) return res.status(400).send('employee_id y date son obligatorios');

    if (off) {
      const { data, error } = await admin
        .from('shifts')
        .update({ off:true, start_time:null, end_time:null, break_minutes:0, break_paid:false, notes })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return res.json(data);
    }

    if (!start_time || !end_time) return res.status(400).send('start_time y end_time requeridos cuando off=false');

    // validar solape con otros (excluyendo el propio)
    const { data: conflict, error: errOverlap } = await admin
      .from('shifts')
      .select('id')
      .eq('employee_id', employee_id)
      .eq('date', date)
      .neq('id', id)
      .lt('start_time', end_time)
      .gt('end_time', start_time)
      .limit(1);
    if (errOverlap) throw errOverlap;
    if (conflict && conflict.length) return res.status(409).send('Turno sovrapposto per lo stesso dipendente');

    const { data, error } = await admin
      .from('shifts')
      .update({ employee_id, date, start_time, end_time, break_minutes, break_paid, off:false, notes })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).send(e.message || 'Error updating shift');
  }
});

// DELETE /api/shifts/:id  (solo manager)
app.delete('/api/shifts/:id', requireManager, async (req, res) => {
  try {
    const id = req.params.id;
    const { error } = await admin.from('shifts').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).send(e.message || 'Error deleting shift');
  }
});

// ==== Fallback SPA (Express 5 compatible, sin '*') ====
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ==== Start ====
app.listen(PORT, () => console.log(`CREMA server listo en http://localhost:${PORT}`));