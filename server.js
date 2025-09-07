import express from 'express';
import cors from 'cors';
import multer from 'multer';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

// ⚠️ Solo cargar dotenv en desarrollo
if (process.env.NODE_ENV !== 'production') {
  const dotenv = await import('dotenv');
  dotenv.config();
}

const app = express();
const port = process.env.PORT || 3000;

// 📦 Supabase client (usa SERVICE_ROLE solo en backend)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// 🧪 Ruta simple para verificar si funciona
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running ✅' });
});

// Aquí puedes agregar tus rutas para empleados, login, turnos, etc.

// 🟢 Iniciar el servidor
app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
