# MOG

Nueva app base sobre Next.js y Docker, creada tras eliminar por completo el proyecto anterior.

## Desarrollo

```bash
npm install
npm run dev
```

## Docker

```bash
docker compose up --build
```

La app queda disponible en `http://localhost:3010`.# Reservas App — Sistema de Citas para Barbería

App de reservas estilo Calendly, construida desde cero con Docker.

## Stack

| Servicio | Tecnología | Puerto |
|----------|-----------|--------|
| **Frontend** | Next.js 15 / React 19 / TypeScript / Tailwind v4 | 3000 |
| **Backend** | Express / TypeScript / Prisma ORM | 3001 |
| **Base de datos** | PostgreSQL 16 | 5432 |
| **Adminer** | Interfaz web para BD | 8082 |

## Inicio rápido

```bash
# 1. Copiar variables de entorno
cp .env.example .env

# 2. Levantar todo
docker compose up --build

# 3. Ejecutar migraciones (primera vez)
docker exec -it reservas_backend npx prisma migrate dev

# 4. Abrir en navegador
#    Frontend:  http://localhost:3000
#    Backend:   http://localhost:3001
#    Adminer:   http://localhost:8082
```

## Comandos útiles

```bash
# Levantar en segundo plano
docker compose up -d --build

# Ver logs de un servicio
docker compose logs -f backend

# Apagar
docker compose down

# Apagar y borrar volúmenes (resetea BD)
docker compose down -v

# Entrar al contenedor del backend
docker exec -it reservas_backend sh

# Regenerar cliente Prisma
docker exec -it reservas_backend npx prisma generate

# Crear nueva migración
docker exec -it reservas_backend npx prisma migrate dev --name nombre_migracion

# Abrir Prisma Studio (GUI de BD)
docker exec -it reservas_backend npx prisma studio
```

## Módulos del backend

| Módulo | Descripción |
|--------|------------|
| `auth` | Login, registro, JWT |
| `bookings` | Crear, cancelar, reprogramar, listar reservas |
| `customers` | CRUD de clientes (nombre, teléfono, email) |
| `services` | Tipos de cita (corte 30min, barba 15min, etc.) |
| `availability` | Horarios del negocio, huecos disponibles, buffers |
| `calendars` | Integración Google Calendar |
| `reminders` | Recordatorios automáticos antes de la cita |
| `notifications` | Canal común: email + WhatsApp |

## Flujo de desarrollo

1. ✅ Levantar Docker → Postgres + Backend + Frontend
2. ✅ Verificar que la BD responde (Adminer)
3. 🔲 CRUD de servicios y disponibilidad
4. 🔲 Flujo de reserva completo
5. 🔲 Integración Google Calendar
6. 🔲 Emails de confirmación/recordatorio
7. ✅ WhatsApp Cloud API para notificaciones y recordatorios

## Estructura

```
reservas-app/
├─ docker-compose.yml
├─ .env / .env.example
├─ frontend/          → Next.js 15
├─ backend/           → Express + Prisma
├─ postgres/init/     → Scripts SQL iniciales (opcional)
└─ ops/               → Nginx, scripts de deploy
```
