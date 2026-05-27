# 🍽️ Dashboard de Pedidos para Restaurante

Dashboard en tiempo real para gestionar pedidos de delivery, integrado con n8n.

## Instalación

```bash
cd restaurante-dashboard
npm install
npm start
```

Abre `http://localhost:3001` en el navegador.

---

## Cómo recibe pedidos desde n8n

n8n debe hacer un `POST` a:
```
http://TU-IP:3001/api/pedido
```

### Formato del JSON (flexible):
```json
{
  "cliente": "María López",
  "telefono": "555-1234",
  "direccion": "Calle Principal 45, Col. Centro",
  "items": [
    { "nombre": "Pizza Margarita", "cantidad": 1, "precio": 180 },
    { "nombre": "Refresco", "cantidad": 2, "precio": 30 }
  ],
  "total": 240,
  "notas": "Sin picante"
}
```

Campos opcionales: `pedido_id`, `telefono`, `direccion`, `notas`

---

## Cómo envía actualizaciones de estado a n8n

Cuando cambias el estado de un pedido en el dashboard, el servidor hace un `POST` automático al webhook de n8n configurado en `.env`:

```
N8N_WEBHOOK_ESTADO=https://tu-n8n.com/webhook/estado-pedido
```

El JSON que recibe n8n:
```json
{
  "pedido_id": "PED-0001",
  "cliente": "María López",
  "telefono": "555-1234",
  "estado": "camino",
  "actualizado": "2026-05-26T15:30:00.000Z"
}
```

---

## Estados del pedido

| Estado | Significado |
|--------|-------------|
| `preparacion` | El pedido está siendo preparado en cocina |
| `camino` | El pedido va en camino al cliente |
| `entregado` | El pedido fue entregado exitosamente |

---

## Variables de entorno (.env)

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `PORT` | Puerto del servidor | `3001` |
| `NOMBRE_RESTAURANTE` | Nombre que aparece en el header | `La Buena Mesa` |
| `N8N_WEBHOOK_ESTADO` | URL webhook de n8n para recibir cambios de estado | `https://...` |
| `WEBHOOK_SECRET` | Token de seguridad (opcional) | cualquier texto |

---

## Seguridad (opcional)

Si defines `WEBHOOK_SECRET=mi-token-secreto` en `.env`, n8n debe enviar el header:
```
Authorization: Bearer mi-token-secreto
```
