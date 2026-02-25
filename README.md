# RPG Peba (MMORPG 2D Simples)

Projeto MVP de MMORPG topdown com:

- Backend `Node.js + TypeScript + Fastify + Socket.IO + Prisma + SQLite + Zod`
- Frontend `React + socket.io-client` com render em grid 20x20
- Login/cadastro, criacao de personagem, movimento em tempo real, ataque, HP e inventario de 6 slots

## Funcionalidades

- Criar conta (`POST /api/auth/register`)
- Login (`POST /api/auth/login`)
- Criar personagem (`POST /api/characters`)
- Conectar em tempo real via WebSocket
- Movimentar no mapa 20x20 com `W A S D`
- Atacar com `Espaco` (alvo em alcance) ou clique no inimigo
- Visualizar outros jogadores online em tempo real
- HP com dano e respawn ao zerar
- Inventario persistente com 6 slots

## Estrutura

- `backend/` API REST + Socket.IO + Prisma + SQLite
- `frontend/` Cliente React

## Requisitos

- Node.js 20+
- npm 10+
- ngrok (para tunel publico)

## Setup local

1. Instale dependencias:

```bash
npm --prefix backend install
npm --prefix frontend install
```

2. Configure variaveis de ambiente:

```bash
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
```

3. Gere o cliente Prisma e crie o banco:

```bash
npm --prefix backend run prisma:generate
npm --prefix backend run db:init
```

4. Rode backend e frontend em terminais separados:

```bash
npm --prefix backend run dev
npm --prefix frontend run dev
```

5. Acesse:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`

## API HTTP (REST)

- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` (Bearer token)
- `POST /api/characters` (Bearer token)
- `GET /api/characters/me` (Bearer token)
- `POST /api/characters/me/inventory` (Bearer token)
- `GET /api/world/state`

Exemplo rapido de cadastro:

```bash
curl -X POST http://localhost:3000/api/auth/register ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"peba\",\"password\":\"123456\"}"
```

## WebSocket (Socket.IO)

Cliente conecta com token JWT em `auth.token`.

Eventos do cliente:

- `player:move` payload `{ direction: "up" | "down" | "left" | "right" }`
- `player:attack` payload opcional `{ targetId?: number }`

Eventos do servidor:

- `world:ready`
- `world:update`
- `combat:event`

## ngrok (acesso externo)

1. Com backend e frontend rodando localmente, abra dois tuneis:

```bash
ngrok http 3000
ngrok http 5173
```

2. Pegue a URL publica do backend e coloque em `frontend/.env`:

```bash
VITE_API_URL=https://SEU_BACKEND.ngrok-free.app
VITE_WS_URL=https://SEU_BACKEND.ngrok-free.app
```

3. Reinicie o frontend para aplicar o `.env`.

4. Compartilhe a URL publica do frontend gerada pelo `ngrok http 5173`.
