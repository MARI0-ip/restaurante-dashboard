require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const NOMBRE_RESTAURANTE = process.env.NOMBRE_RESTAURANTE || 'Mi Restaurante';
const N8N_WEBHOOK_ESTADO = process.env.N8N_WEBHOOK_ESTADO || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────
// Almacenamiento en memoria
// ──────────────────────────────────────────────
const pedidos  = new Map(); // pedidos activos (preparacion / camino)
const registros = [];       // pedidos entregados archivados
let contadorId = 1;

// ──────────────────────────────────────────────
// SSE - tiempo real
// ──────────────────────────────────────────────
const clientes = new Set();

function enviarEvento(tipo, datos) {
  const mensaje = `data: ${JSON.stringify({ tipo, datos })}\n\n`;
  clientes.forEach(res => res.write(mensaje));
}

app.get('/api/eventos', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Estado inicial completo al conectarse
  res.write(`data: ${JSON.stringify({
    tipo: 'init',
    datos: {
      pedidos:   Array.from(pedidos.values()),
      registros: resumenRegistros(),
    }
  })}\n\n`);

  clientes.add(res);
  req.on('close', () => clientes.delete(res));
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
// DELETE /api/registros  →  limpiar historial
// ──────────────────────────────────────────────
app.delete('/api/registros', (req, res) => {
  registros.length = 0;
  enviarEvento('registros_limpiados', resumenRegistros());
  console.log('🧹 Registros limpiados');
  res.json({ ok: true });
});

// ──────────────────────────────────────────────
// POST /api/pedido  →  recibir desde n8n
// ──────────────────────────────────────────────
app.post('/api/pedido', (req, res) => {
  if (WEBHOOK_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${WEBHOOK_SECRET}`) {
      return res.status(401).json({ error: 'No autorizado' });
    }
  }

  const datos = req.body;
  if (!datos.cliente && !datos.nombre_cliente) {
    return res.status(400).json({ error: 'Se requiere el campo "cliente"' });
  }

  const id = datos.pedido_id || `PED-${String(contadorId++).padStart(4, '0')}`;
  const pedido = {
    id,
    cliente:     datos.cliente || datos.nombre_cliente || 'Cliente',
    telefono:    datos.telefono || datos.phone || '',
    direccion:   datos.direccion || datos.address || '',
    items:       datos.items || datos.productos || [],
    total:       datos.total || datos.monto || calcularTotal(datos.items || datos.productos || []),
    notas:       datos.notas || datos.observaciones || '',
    estado:      'preparacion',
    recibido:    new Date().toISOString(),
    actualizado: new Date().toISOString(),
  };

  pedidos.set(id, pedido);
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

  const estadosValidos = ['preparacion', 'camino', 'entregado'];
  if (!estadosValidos.includes(estado)) {
    return res.status(400).json({ error: `Estado inválido. Usar: ${estadosValidos.join(', ')}` });
  }

  const pedido = pedidos.get(id);
  if (!pedido) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }

  pedido.estado      = estado;
  pedido.actualizado = new Date().toISOString();

  if (estado === 'entregado') {
    // Archivar: sale de pedidos activos, entra a registros
    pedido.entregado_en = new Date().toISOString();
    registros.push({ ...pedido });
    pedidos.delete(id);

    enviarEvento('pedido_archivado', {
      pedido,
      resumen: resumenRegistros(),
    });
    console.log(`📦 Pedido ${id} archivado → total acumulado: $${resumenRegistros().total_ventas}`);
  } else {
    pedidos.set(id, pedido);
    enviarEvento('estado_actualizado', pedido);
    console.log(`🔄 Pedido ${id} → estado: ${estado}`);
  }

  // Notificar a n8n
  if (N8N_WEBHOOK_ESTADO) {
    try {
      const resp = await fetch(N8N_WEBHOOK_ESTADO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pedido_id:   id,
          cliente:     pedido.cliente,
          telefono:    pedido.telefono,
          estado,
          actualizado: pedido.actualizado,
        }),
      });
      console.log(`  ↳ n8n notificado: HTTP ${resp.status}`);
    } catch (err) {
      console.warn(`  ⚠️  No se pudo notificar a n8n: ${err.message}`);
    }
  }

  res.json({ ok: true, pedido });
});

// ──────────────────────────────────────────────
// DELETE /api/pedido/:id  →  eliminar activo
// ──────────────────────────────────────────────
app.delete('/api/pedido/:id', (req, res) => {
  const { id } = req.params;
  if (!pedidos.has(id)) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }
  pedidos.delete(id);
  enviarEvento('pedido_eliminado', { id });
  res.json({ ok: true });
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function calcularTotal(items) {
  return items.reduce((sum, i) => sum + (i.precio || 0) * (i.cantidad || 1), 0);
}

function resumenRegistros() {
  const total_ventas  = registros.reduce((s, p) => s + (p.total || 0), 0);
  const cantidad      = registros.length;
  const ticket_prom   = cantidad > 0 ? Math.round(total_ventas / cantidad) : 0;
  return { registros, total_ventas, cantidad, ticket_prom };
}

// ──────────────────────────────────────────────
// Iniciar
// ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log(`🍽️  Dashboard de ${NOMBRE_RESTAURANTE}`);
  console.log(`   http://localhost:${PORT}`);
  console.log('');
  console.log('Endpoints:');
  console.log(`  POST   /api/pedido              ← n8n envía pedidos aquí`);
  console.log(`  PUT    /api/pedido/:id/estado   ← cambia estado`);
  console.log(`  GET    /api/registros           ← historial de entregados`);
  console.log(`  DELETE /api/registros           ← limpiar historial`);
  if (!N8N_WEBHOOK_ESTADO) {
    console.log(`\n  ⚠️  N8N_WEBHOOK_ESTADO no configurado`);
  }
  console.log('');
});
