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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Healthcheck per Render
app.get('/healthz', (req, res) => res.status(200).send('ok'));

const adminUser = process.env.ADMIN_USERNAME || 'admin';
let passwordHash;
(async () => {
  passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'crema123', 10);
})();

const storage = multer.memoryStorage();
const upload = multer({ storage });

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

// ====================== AUTH ======================
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (username !== adminUser) return res.status(401).json({ error: 'Credenziali non valide' });
  const valid = await bcrypt.compare(password, passwordHash);
  if (!valid) return res.status(401).json({ error: 'Credenziali non valide' });
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

// ====================== PRODUCTS ======================
app.get('/api/products', async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/products', auth, async (req, res) => {
  const payload = req.body;
  if (!payload.name) return res.status(400).json({ error: 'Nome richiesto' });
  const { data, error } = await supabase.from('products').insert(payload).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/api/products/:id', auth, async (req, res) => {
  const id = req.params.id;
  const payload = req.body;
  const { data, error } = await supabase.from('products').update(payload).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/products/:id', auth, async (req, res) => {
  const id = req.params.id;
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Upload immagine → Supabase Storage
app.post('/api/upload', auth, upload.single('image'), async (req, res) => {
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

// ====================== EMPLOYEES ======================
app.get('/api/employees', auth, async (req, res) => {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .order('is_active', { ascending: false })
    .order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/employees', auth, async (req, res) => {
  const { name, role, is_active = true } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome richiesto' });
  const { data, error } = await supabase
    .from('employees')
    .insert({ name, role, is_active })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/api/employees/:id', auth, async (req, res) => {
  const id = req.params.id;
  const { name, role, is_active } = req.body;
  const { data, error } = await supabase
    .from('employees')
    .update({ name, role, is_active })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/employees/:id', auth, async (req, res) => {
  const id = req.params.id;
  const { error } = await supabase.from('employees').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ====================== SHIFTS ======================
// Lista per intervallo (from/to YYYY-MM-DD), opzionale filtro employee_id
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

app.post('/api/shifts', auth, async (req, res) => {
  const { employee_id, work_date, start_time, end_time, break_minutes = 0, notes } = req.body;
  if (!employee_id || !work_date || !start_time || !end_time) {
    return res.status(400).json({ error: 'Campi obbligatori mancanti' });
  }

  // controllo semplice di sovrapposizione turni dello stesso dipendente nello stesso giorno:
  // esiste un turno con start < new_end AND end > new_start
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

app.put('/api/shifts/:id', auth, async (req, res) => {
  const id = req.params.id;
  const { employee_id, work_date, start_time, end_time, break_minutes = 0, notes } = req.body;

  // (opzionale) stesso controllo sovrapposizione escludendo il record stesso
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

app.delete('/api/shifts/:id', auth, async (req, res) => {
  const id = req.params.id;
  const { error } = await supabase.from('shifts').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});
// Disabilita cache per i file HTML
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});




// ✅ Fallback universale senza wildcard (compatibile Express 5)
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`CREMA (Supabase) su http://localhost:${PORT}`));