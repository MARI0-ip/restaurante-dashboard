require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const crypto       = require('crypto');
const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const fs           = require('fs');

const app = express();
const PORT               = process.env.PORT               || 3001;
const NOMBRE_RESTAURANTE = process.env.NOMBRE_RESTAURANTE || 'Mi Restaurante';
const N8N_WEBHOOK_ESTADO = process.env.N8N_WEBHOOK_ESTADO || '';
const WEBHOOK_SECRET     = process.env.WEBHOOK_SECRET     || '';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';

// Clave secreta para firmar JWT (se genera automáticamente si no está en .env)
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRY = '30d'; // sesión dura 30 días (ideal para tablet en mostrador)

// ──────────────────────────────────────────────
// Middleware base
// ──────────────────────────────────────────────
app.use(cors({ origin: false })); // sin CORS público
app.use(express.json());
app.use(cookieParser());

// ──────────────────────────────────────────────
// Rate limiter para login (anti fuerza bruta)
// ──────────────────────────────────────────────
const intentosFallidos = new Map(); // ip => { count, bloqueadoHasta }
const MAX_INTENTOS   = 5;
const BLOQUEO_MS     = 15 * 60 * 1000; // 15 minutos

function verificarRateLimit(ip) {
  const ahora = Date.now();
  const entry = intentosFallidos.get(ip) || { count: 0, bloqueadoHasta: 0 };

  if (entry.bloqueadoHasta > ahora) {
    const restantes = Math.ceil((entry.bloqueadoHasta - ahora) / 60000);
    return { bloqueado: true, minutosRestantes: restantes };
  }

  return { bloqueado: false, intentosRestantes: MAX_INTENTOS - entry.count };
}

function registrarIntentoFallido(ip) {
  const ahora = Date.now();
  const entry = intentosFallidos.get(ip) || { count: 0, bloqueadoHasta: 0 };
  entry.count++;
  if (entry.count >= MAX_INTENTOS) {
    entry.bloqueadoHasta = ahora + BLOQUEO_MS;
    entry.count = 0;
    console.warn(`🔒 IP bloqueada por 15 min: ${ip}`);
  }
  intentosFallidos.set(ip, entry);
}

function resetearIntentos(ip) {
  intentosFallidos.delete(ip);
}

// ──────────────────────────────────────────────
// Comparación segura de contraseña (anti-timing attack)
// ──────────────────────────────────────────────
function verificarPassword(input, esperada) {
  if (!esperada) return true; // sin password configurada = libre
  try {
    const a = Buffer.from(input.padEnd(72).slice(0, 72));
    const b = Buffer.from(esperada.padEnd(72).slice(0, 72));
    return crypto.timingSafeEqual(a, b) && input === esperada;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────
// Middleware de autenticación JWT
// ──────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!DASHBOARD_PASSWORD) return next(); // sin password = acceso libre

  // Rutas exentas de autenticación
  const publicRoutes = ['/login', '/api/login'];
  if (publicRoutes.includes(req.path)) return next();

  // n8n puede hacer POST a /api/pedido con WEBHOOK_SECRET
  if (req.path === '/api/pedido' && req.method === 'POST') return next();

  // Leer token desde cookie HttpOnly
  const token = req.cookies?.auth_token;

  if (!token) {
    if (req.accepts('html')) return res.redirect('/login');
    return res.status(401).json({ error: 'No autenticado' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = payload;
    next();
  } catch (err) {
    res.clearCookie('auth_token');
    if (req.accepts('html')) return res.redirect('/login');
    return res.status(401).json({ error: 'Sesión expirada, vuelve a iniciar sesión' });
  }
}

app.use(requireAuth);

// ──────────────────────────────────────────────
// GET /login — página de inicio de sesión
// ──────────────────────────────────────────────
app.get('/login', (req, res) => {
  // Si ya tiene sesión válida, redirigir al dashboard
  const token = req.cookies?.auth_token;
  if (token) {
    try { jwt.verify(token, JWT_SECRET); return res.redirect('/'); } catch {}
  }

  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Acceso — ${NOMBRE_RESTAURANTE}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f1117;color:#e8eaf0;
         display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:#1a1d27;border:1px solid #2e3347;border-radius:16px;
          padding:40px 36px;width:min(380px,92vw);text-align:center;
          box-shadow:0 8px 32px rgba(0,0,0,.6)}
    .logo{font-size:2.8rem;margin-bottom:14px}
    h1{font-size:1.2rem;font-weight:700;margin-bottom:6px}
    .sub{font-size:.82rem;color:#7c82a0;margin-bottom:28px}
    input{width:100%;padding:12px 14px;background:#0f1117;border:1px solid #2e3347;
          border-radius:8px;color:#e8eaf0;font-size:.95rem;margin-bottom:14px;
          outline:none;transition:border .15s}
    input:focus{border-color:#3d9cf0}
    button{width:100%;padding:12px;background:#3d9cf0;border:none;border-radius:8px;
           color:#fff;font-size:.95rem;font-weight:700;cursor:pointer;transition:background .15s}
    button:hover{background:#2d8ce0}
    button:disabled{background:#1a3a5c;cursor:not-allowed}
    .msg{margin-top:12px;font-size:.82rem;min-height:20px;border-radius:6px;padding:6px 10px}
    .msg.error{background:rgba(248,113,113,.1);color:#f87171;border:1px solid rgba(248,113,113,.3)}
    .msg.bloqueo{background:rgba(251,191,36,.1);color:#fbbf24;border:1px solid rgba(251,191,36,.3)}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🍽️</div>
    <h1>${NOMBRE_RESTAURANTE}</h1>
    <p class="sub">Panel de pedidos — acceso restringido</p>
    <input type="password" id="pwd" placeholder="Contraseña"
           autocomplete="current-password"
           onkeydown="if(event.key==='Enter')login()"/>
    <button id="btn" onclick="login()">Iniciar sesión</button>
    <div class="msg" id="msg"></div>
  </div>
  <script>
    let enviando = false;
    async function login() {
      if (enviando) return;
      const pwd = document.getElementById('pwd').value.trim();
      if (!pwd) return;
      enviando = true;
      const btn = document.getElementById('btn');
      const msg = document.getElementById('msg');
      btn.disabled = true;
      btn.textContent = 'Verificando...';
      msg.className = 'msg'; msg.textContent = '';
      try {
        const r = await fetch('/api/login', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          credentials: 'include',
          body: JSON.stringify({ password: pwd })
        });
        const data = await r.json();
        if (r.ok) {
          window.location.href = '/';
        } else if (r.status === 429) {
          msg.className = 'msg bloqueo';
          msg.textContent = data.error;
        } else {
          msg.className = 'msg error';
          msg.textContent = data.error || 'Contraseña incorrecta';
          document.getElementById('pwd').value = '';
          document.getElementById('pwd').focus();
        }
      } catch {
        msg.className = 'msg error';
        msg.textContent = 'Error de conexión, intenta de nuevo';
      } finally {
        enviando = false;
        btn.disabled = false;
        btn.textContent = 'Iniciar sesión';
      }
    }
  </script>
</body>
</html>`);
});

// ──────────────────────────────────────────────
// POST /api/login
// ──────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  if (!DASHBOARD_PASSWORD) {
    // Sin password configurada: emitir token de todas formas
    const token = jwt.sign({ rol: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure:   req.secure || req.headers['x-forwarded-proto'] === 'https',
      sameSite: 'Strict',
      maxAge:   30 * 24 * 60 * 60 * 1000, // 30 días en ms
    });
    return res.json({ ok: true });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || 'unknown';
  const limite = verificarRateLimit(ip);

  if (limite.bloqueado) {
    return res.status(429).json({
      error: `Demasiados intentos fallidos. Espera ${limite.minutosRestantes} minuto(s) antes de intentarlo de nuevo.`
    });
  }

  const { password } = req.body || {};

  if (!password || !verificarPassword(password, DASHBOARD_PASSWORD)) {
    registrarIntentoFallido(ip);
    const intentosRestantes = MAX_INTENTOS - (intentosFallidos.get(ip)?.count || 0);
    console.warn(`🔐 Intento fallido desde ${ip} (${intentosRestantes} restantes)`);
    return res.status(401).json({
      error: `Contraseña incorrecta. ${intentosRestantes > 0 ? `Te quedan ${intentosRestantes} intentos.` : 'Cuenta bloqueada temporalmente.'}`
    });
  }

  // Contraseña correcta
  resetearIntentos(ip);
  const token = jwt.sign({ rol: 'admin', ip }, JWT_SECRET, { expiresIn: JWT_EXPIRY });

  res.cookie('auth_token', token, {
    httpOnly: true,                                                   // inaccesible desde JS
    secure:   req.secure || req.headers['x-forwarded-proto'] === 'https', // solo HTTPS
    sameSite: 'Strict',                                               // anti-CSRF
    maxAge:   30 * 24 * 60 * 60 * 1000,                              // 30 días (tablet mostrador)
  });

  console.log(`✅ Login exitoso desde ${ip}`);
  res.json({ ok: true });
});

// ──────────────────────────────────────────────
// POST /api/logout
// ──────────────────────────────────────────────
app.post('/api/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ ok: true });
});

// ──────────────────────────────────────────────
// Archivos estáticos del dashboard
// ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────
// Persistencia en archivo JSON
// ──────────────────────────────────────────────
const DATA_DIR  = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');

function cargarDatos() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const data = JSON.parse(raw);
      console.log(`📂 Datos cargados: ${data.pedidos?.length || 0} pedidos, ${data.registros?.length || 0} registros`);
      return data;
    }
  } catch (err) {
    console.warn('⚠️  No se pudieron cargar los datos guardados:', err.message);
  }
  return { pedidos: [], registros: [], contadorId: 1 };
}

let guardadoPendiente = null;
function guardarDatos() {
  // Debounce: espera 500ms antes de escribir para no golpear el disco en cada cambio
  if (guardadoPendiente) clearTimeout(guardadoPendiente);
  guardadoPendiente = setTimeout(() => {
    try {
      const data = {
        pedidos:    Array.from(pedidos.values()),
        registros,
        contadorId,
        guardado:   new Date().toISOString(),
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('❌ Error guardando datos:', err.message);
    }
  }, 500);
}

// Cargar datos al iniciar
const datosIniciales = cargarDatos();
const pedidos   = new Map(datosIniciales.pedidos.map(p => [p.id, p]));
const registros = datosIniciales.registros || [];
let contadorId  = datosIniciales.contadorId || 1;

// ──────────────────────────────────────────────
// SSE — tiempo real
// ──────────────────────────────────────────────
const clientesSSE = new Set();

function enviarEvento(tipo, datos) {
  const msg = `data: ${JSON.stringify({ tipo, datos })}\n\n`;
  clientesSSE.forEach(r => r.write(msg));
}

app.get('/api/eventos', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({
    tipo: 'init',
    datos: { pedidos: Array.from(pedidos.values()), registros: resumenRegistros() }
  })}\n\n`);

  clientesSSE.add(res);
  req.on('close', () => clientesSSE.delete(res));
});

// ──────────────────────────────────────────────
// GET /api/pedidos
// ──────────────────────────────────────────────
app.get('/api/pedidos', (req, res) => {
  res.json(Array.from(pedidos.values()));
});

// ──────────────────────────────────────────────
// GET /api/registros
// ──────────────────────────────────────────────
app.get('/api/registros', (req, res) => {
  res.json(resumenRegistros());
});

// ──────────────────────────────────────────────
// DELETE /api/registros
// ──────────────────────────────────────────────
app.delete('/api/registros', (req, res) => {
  registros.length = 0;
  guardarDatos();
  enviarEvento('registros_limpiados', resumenRegistros());
  console.log('🧹 Registros limpiados');
  res.json({ ok: true });
});

// ──────────────────────────────────────────────
// POST /api/pedido — recibir desde n8n
// ──────────────────────────────────────────────
app.post('/api/pedido', (req, res) => {
  if (WEBHOOK_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${WEBHOOK_SECRET}`) {
      return res.status(401).json({ error: 'No autorizado' });
    }
  }

  const d = req.body;
  if (!d.cliente && !d.nombre_cliente) {
    return res.status(400).json({ error: 'Se requiere el campo "cliente"' });
  }

  const id = d.pedido_id || `PED-${String(contadorId++).padStart(4, '0')}`;
  const pedido = {
    id,
    cliente:     d.cliente || d.nombre_cliente || 'Cliente',
    telefono:    d.telefono || d.phone || '',
    direccion:   d.direccion || d.address || '',
    items:       d.items || d.productos || [],
    total:       d.total || d.monto || calcularTotal(d.items || d.productos || []),
    notas:       d.notas || d.observaciones || '',
    estado:      'nuevo',
    recibido:    new Date().toISOString(),
    actualizado: new Date().toISOString(),
    historial:   [{ estado: 'nuevo', desde: new Date().toISOString() }],
  };

  pedidos.set(id, pedido);
  guardarDatos();
  enviarEvento('nuevo_pedido', pedido);
  console.log(`✅ Pedido recibido: ${id} para ${pedido.cliente}`);
  res.status(201).json({ ok: true, pedido_id: id, pedido });
});

// ──────────────────────────────────────────────
// PUT /api/pedido/:id/estado
// ──────────────────────────────────────────────
app.put('/api/pedido/:id/estado', async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  const estadosValidos = ['nuevo', 'preparacion', 'camino', 'entregado'];
  if (!estadosValidos.includes(estado)) {
    return res.status(400).json({ error: `Estado inválido. Usar: ${estadosValidos.join(', ')}` });
  }

  const pedido = pedidos.get(id);
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

  pedido.estado      = estado;
  pedido.actualizado = new Date().toISOString();
  pedido.historial   = pedido.historial || [];
  pedido.historial.push({ estado, desde: pedido.actualizado });

  if (estado === 'entregado') {
    pedido.entregado_en = new Date().toISOString();
    registros.push({ ...pedido });
    pedidos.delete(id);
    guardarDatos();
    enviarEvento('pedido_archivado', { pedido, resumen: resumenRegistros() });
    console.log(`📦 Pedido ${id} archivado`);
  } else {
    pedidos.set(id, pedido);
    guardarDatos();
    enviarEvento('estado_actualizado', pedido);
    console.log(`🔄 Pedido ${id} → ${estado}`);
  }

  if (N8N_WEBHOOK_ESTADO) {
    try {
      const r = await fetch(N8N_WEBHOOK_ESTADO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedido_id: id, cliente: pedido.cliente, telefono: pedido.telefono, estado, actualizado: pedido.actualizado }),
      });
      console.log(`  ↳ n8n notificado: HTTP ${r.status}`);
    } catch (err) {
      console.warn(`  ⚠️  No se pudo notificar a n8n: ${err.message}`);
    }
  }

  res.json({ ok: true, pedido });
});

// ──────────────────────────────────────────────
// DELETE /api/pedido/:id
// ──────────────────────────────────────────────
app.delete('/api/pedido/:id', (req, res) => {
  const { id } = req.params;
  if (!pedidos.has(id)) return res.status(404).json({ error: 'Pedido no encontrado' });
  pedidos.delete(id);
  guardarDatos();
  enviarEvento('pedido_eliminado', { id });
  res.json({ ok: true });
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function calcularTotal(items) {
  return (items || []).reduce((s, i) => s + (i.precio || 0) * (i.cantidad || 1), 0);
}

function resumenRegistros() {
  const total_ventas = registros.reduce((s, p) => s + (p.total || 0), 0);
  const cantidad     = registros.length;
  const ticket_prom  = cantidad > 0 ? Math.round(total_ventas / cantidad) : 0;

  // Tiempo promedio de entrega (desde recibido hasta entregado_en)
  const tiempos = registros
    .filter(p => p.recibido && p.entregado_en)
    .map(p => new Date(p.entregado_en) - new Date(p.recibido));
  const tiempo_prom_ms  = tiempos.length > 0 ? tiempos.reduce((s, t) => s + t, 0) / tiempos.length : 0;
  const tiempo_prom_min = Math.round(tiempo_prom_ms / 60000);

  return { registros, total_ventas, cantidad, ticket_prom, tiempo_prom_min };
}

// ──────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log(`🍽️  Dashboard de ${NOMBRE_RESTAURANTE}`);
  console.log(`   http://localhost:${PORT}`);
  if (DASHBOARD_PASSWORD) {
    console.log(`   🔐 Autenticación activa (JWT 8h, rate limit ${MAX_INTENTOS} intentos)`);
  } else {
    console.log(`   ⚠️  Sin contraseña — agrega DASHBOARD_PASSWORD al .env`);
  }
  console.log('');
});
