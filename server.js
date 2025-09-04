import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { createClient } from '@supabase/supabase-js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const BUCKET = process.env.SUPABASE_BUCKET || 'crema-images';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false }
});

app.use(cors());
// No cache sugli HTML (utile per login/admin)
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Healthcheck per Render
app.get('/healthz', (req, res) => res.status(200).send('ok'));

// ====== AUTH helpers ======
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token mancante' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Token non valido' });
  }
}
function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'Solo admin' });
}

// ====== Admin bootstrap ======
const adminUser = process.env.ADMIN_USERNAME || 'admin';
let passwordHashAdmin;
(async () => {
  passwordHashAdmin = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'crema123', 10);
})();

// ====== AUTH: Admin ======
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (username !== adminUser) return res.status(401).json({ error: 'Credenziali non valide' });
  const valid = await bcrypt.compare(password, passwordHashAdmin);
  if (!valid) return res.status(401).json({ error: 'Credenziali non valide' });
  const token = jwt.sign({ role: 'admin', username }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

// ====== AUTH: Dipendente (email + password) ======
app.post('/api/auth/employee', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e password richiesti' });

  const { data: emp, error } = await supabase
    .from('employees')
    .select('id, name, role, is_active, email, password_hash')
    .eq('email', email)
    .single();

  if (error || !emp || !emp.is_active) return res.status(401).json({ error: 'Credenziali non valide' });
  if (!emp.password_hash) return res.status(401).json({ error: 'Password non impostata. Contatta il manager.' });

  const ok = await bcrypt.compare(password, emp.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenziali non valide' });

  const token = jwt.sign({ role: 'employee', employee_id: emp.id, name: emp.name }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, employee: { id: emp.id, name: emp.name, role: emp.role } });
});

// ====== PRODUCTS ======
app.get('/api/products', async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/products', auth, requireAdmin, async (req, res) => {
  const payload = req.body;
  if (!payload.name) return res.status(400).json({ error: 'Nome richiesto' });
  const { data, error } = await supabase.from('products').insert(payload).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/api/products/:id', auth, requireAdmin, async (req, res) => {
  const id = req.params.id;
  const payload = req.body;
  const { data, error } = await supabase.from('products').update(payload).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/products/:id', auth, requireAdmin, async (req, res) => {
  const id = req.params.id;
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Upload immagine → Supabase Storage
const storage = multer.memoryStorage();
const upload = multer({ storage });
app.post('/api/upload', auth, requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Nessun file caricato' });
    const ext = (file.originalname && file.originalname.includes('.')) ? file.originalname.split('.').pop() : 'jpg';
    const filename = `${Date.now()}-${Math.round(Math.random()*1e9)}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(filename, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });
    if (error) return res.status(500).json({ error: error.message });
    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(filename);
    res.json({ url: publicUrlData.publicUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ====== EMPLOYEES ======
// GET: Admin vede anche email, i dipendenti vedono solo (id,name,role,is_active)
app.get('/api/employees', auth, async (req, res) => {
  if (req.user.role === 'admin') {
    const { data, error } = await supabase
      .from('employees')
      .select('id, name, role, is_active, email, created_at')
      .order('is_active', { ascending: false })
      .order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } else {
    const { data, error } = await supabase
      .from('employees')
      .select('id, name, role, is_active')
      .order('is_active', { ascending: false })
      .order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
});

// POST: crea dipendente (admin). Se arriva password, viene hashata.
app.post('/api/employees', auth, requireAdmin, async (req, res) => {
  const { name, role, is_active = true, email, password, is_manager = false } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome richiesto' });
  let password_hash = null;
  if (password) password_hash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from('employees')
    .insert({ name, role, is_active, email: email || null, password_hash, is_manager })
    .select('id, name, role, is_active, email')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PUT: aggiorna dipendente (admin). Per reset password, passare { new_password }
app.put('/api/employees/:id', auth, requireAdmin, async (req, res) => {
  const id = req.params.id;
  const { name, role, is_active, email, new_password, is_manager } = req.body;
  const update = { name, role, is_active, email, is_manager };
  if (new_password) update.password_hash = await bcrypt.hash(new_password, 10);

  const { data, error } = await supabase
    .from('employees')
    .update(update)
    .eq('id', id)
    .select('id, name, role, is_active, email')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/employees/:id', auth, requireAdmin, async (req, res) => {
  const id = req.params.id;
  const { error } = await supabase.from('employees').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ====== SHIFTS ======
// lettura libera a chi è autenticato (admin o dipendente)
app.get('/api/shifts', auth, async (req, res) => {
  const { from, to, employee_id } = req.query;
  let q = supabase
    .from('shifts')
    .select('*, employees!inner(id,name,role)')
    .order('work_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (from) q = q.gte('work_date', from);
  if (to)   q = q.lte('work_date', to);
  if (employee_id) q = q.eq('employee_id', employee_id);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// mutazioni solo admin
app.post('/api/shifts', auth, requireAdmin, async (req, res) => {
  const { employee_id, work_date, start_time, end_time, break_minutes = 0, notes } = req.body;
  if (!employee_id || !work_date || !start_time || !end_time) {
    return res.status(400).json({ error: 'Campi obbligatori mancanti' });
  }
  // controllo sovrapposizione
  const { data: conflict, error: errOverlap } = await supabase
    .from('shifts')
    .select('id')
    .eq('employee_id', employee_id)
    .eq('work_date', work_date)
    .lt('start_time', end_time)
    .gt('end_time', start_time)
    .limit(1);

  if (errOverlap) return res.status(500).json({ error: errOverlap.message });
  if (conflict && conflict.length) {
    return res.status(409).json({ error: 'Turno sovrapposto per lo stesso dipendente' });
  }

  const { data, error } = await supabase
    .from('shifts')
    .insert({ employee_id, work_date, start_time, end_time, break_minutes, notes })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/api/shifts/:id', auth, requireAdmin, async (req, res) => {
  const id = req.params.id;
  const { employee_id, work_date, start_time, end_time, break_minutes = 0, notes } = req.body;
  const { data: conflict, error: errOverlap } = await supabase
    .from('shifts')
    .select('id')
    .eq('employee_id', employee_id)
    .eq('work_date', work_date)
    .neq('id', id)
    .lt('start_time', end_time)
    .gt('end_time', start_time)
    .limit(1);

  if (errOverlap) return res.status(500).json({ error: errOverlap.message });
  if (conflict && conflict.length) {
    return res.status(409).json({ error: 'Turno sovrapposto per lo stesso dipendente' });
  }

  const { data, error } = await supabase
    .from('shifts')
    .update({ employee_id, work_date, start_time, end_time, break_minutes, notes })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/shifts/:id', auth, requireAdmin, async (req, res) => {
  const id = req.params.id;
  const { error } = await supabase.from('shifts').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Fallback universale (no wildcard)
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`CREMA (Supabase) su http://localhost:${PORT}`));