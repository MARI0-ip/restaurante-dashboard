# 🍽️ El Vikingo — Proceso Actual del Sistema de Pedidos

## Stack funcionando

| Componente | Estado | Detalle |
|---|---|---|
| **Vapi** | ✅ Activo | Agente de voz que toma pedidos por teléfono |
| **n8n** | ✅ Activo | En el mismo servidor (EasyPanel / Hostinger) |
| **Dashboard** | ✅ Activo | Panel de pedidos en tiempo real |
| **Telegram** | 🔧 Por conectar | Confirmación de pedidos con el cliente |

---

## URL y accesos

- **Dashboard:** `https://restaurante-dashboard-restaurante-dashboard.wsastb.easypanel.host`
- **Repo GitHub:** `https://github.com/MARI0-ip/restaurante-dashboard`

---

## Flujo completo del pedido

```
Cliente llama a Vapi
        ↓
Vapi toma el pedido por voz
(aunque el micrófono sea malo)
        ↓
Vapi manda los datos a n8n (tool call / webhook)
        ↓
n8n procesa con IA → arma JSON limpio del pedido
        ↓
n8n revisa el horario:
  ├── Fuera de horario → Vapi dice "Estamos cerrados" y cuelga
  └── Dentro de horario → continúa el flujo
        ↓
n8n manda mensaje a Telegram al cliente:

  "Hola 👋 Esto es lo que entendí de tu pedido:
   👤 María López
   📍 Calle Principal 45, Col. Centro
   🛒 2× Pizza Margarita — $360
       1× Refresco — $30
   💰 Total: $390
   
   ¿Es correcto? Responde ✅ SÍ para confirmar
   o escribe directamente la corrección."
        ↓
Vapi avisa al cliente en la llamada:
"Te acabo de mandar un Telegram con tu pedido,
 puedes confirmar o corregir ahí lo que 
 no esté bien."
        ↓
Cliente responde en Telegram
(puede hacerlo mientras sigue en la llamada)
        ↓
n8n recibe la respuesta:
  ├── ✅ SÍ / confirmación → manda pedido al dashboard
  └── ✏️ Corrección → actualiza datos → manda al dashboard
        ↓
Pedido aparece en dashboard → columna "🆕 Nuevo Pedido"
        ↓
Restaurante gestiona: Prep. → En camino → Entregado ✅
```

---

## Endpoint del dashboard

```
POST /api/pedido
```

```json
{
  "cliente":   "Nombre del cliente",
  "telefono":  "555-1234",
  "direccion": "Calle y número",
  "items": [
    { "nombre": "Pizza Margarita", "cantidad": 2, "precio": 180 },
    { "nombre": "Refresco",        "cantidad": 1, "precio": 30  }
  ],
  "total": 390,
  "notas": "Sin cebolla"
}
```

### Estados del pedido

```
nuevo → preparacion → camino → entregado
```

---

## Control de horario (por implementar en n8n)

- **Dentro del horario** → Vapi atiende normalmente
- **Fuera del horario** → Vapi dice:
  > *"Gracias por llamar a El Vikingo. En este momento estamos cerrados. Nuestro horario es de 1pm a 10pm. ¡Hasta pronto!"*
- La llamada dura ~5 segundos (no consume minutos completos)
- El horario se configura en n8n — se puede cambiar por día o por festivo sin tocar Vapi

---

## ✅ Cómo conectar n8n con el Dashboard

### 1. Variables de entorno en EasyPanel

**En la app `restaurante-dashboard` → "Environment":**
```
WEBHOOK_SECRET=vikingo-secret-2024
```

**En la app `n8n` → "Environment":**
```
DASHBOARD_URL=https://restaurante-dashboard-restaurante-dashboard.wsastb.easypanel.host
WEBHOOK_SECRET=vikingo-secret-2024
```

> Guarda y haz Redeploy en ambas apps.

**Alternativa red interna (más rápido, sin salir a internet):**
```
DASHBOARD_URL=http://restaurante-dashboard:3001
```
Úsala si el nombre del contenedor en EasyPanel es `restaurante-dashboard`.

---

### 2. Nodo HTTP Request en n8n

Importa el archivo [`snippet-http-pedido.json`](./snippet-http-pedido.json) en tu workflow  
(copia el contenido y pégalo con `Ctrl+V` en el canvas de n8n).

O configura el nodo manualmente:

| Campo | Valor |
|-------|-------|
| Method | `POST` |
| URL | `={{ $env.DASHBOARD_URL }}/api/pedido` |
| Header `Authorization` | `=Bearer {{ $env.WEBHOOK_SECRET }}` |
| Body | JSON con los campos del pedido |

---

### 3. Probar la conexión

**Desde curl (terminal del VPS):**
```bash
curl -X POST https://restaurante-dashboard-restaurante-dashboard.wsastb.easypanel.host/api/pedido \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer vikingo-secret-2024" \
  -d '{"cliente":"Test","items":[{"nombre":"Pizza","cantidad":1,"precio":180}]}'
```

Respuesta esperada:
```json
{ "ok": true, "pedido_id": "PED-0001", "pedido": { ... } }
```

Abre el dashboard → debería aparecer el pedido en **"🆕 Nuevo Pedido"**.

---

### Errores comunes

| Error | Causa | Solución |
|-------|-------|---------|
| `401 No autorizado` | WEBHOOK_SECRET no coincide | Verifica que sea idéntico en ambas apps |
| `400 Se requiere "cliente"` | Falta el campo cliente en el body | Agrega `"cliente": "Nombre"` |
| `Connection refused` | URL interna incorrecta | Usa la URL pública del dashboard |
| Env vars no aplicadas | Faltó Redeploy | Redeploy de n8n tras agregar variables |

---

## Por conectar / próximos pasos

- [x] Endpoint `/api/pedido` del dashboard documentado
- [x] Instrucciones de conexión n8n ↔ Dashboard
- [ ] Configurar bot de Telegram en n8n
- [ ] Conectar Vapi con n8n (tool call o server URL)
- [ ] Workflow n8n: procesar pedido de voz → Telegram → dashboard
- [ ] Implementar control de horario en n8n
- [ ] Probar flujo completo con Telegram
- [ ] (Futuro) Migrar confirmaciones de Telegram a WhatsApp
