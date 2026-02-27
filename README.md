# RPG Peba MMO (Protótipo)

Protótipo simples de MMO com:

- autenticação via JWT
- criação de personagem
- mapa em tempo real via Socket.IO
- persistência de posição e dados no banco (Prisma + SQLite)

## Stack

- Backend: `Node.js + Fastify + Socket.IO + Prisma + JWT + Zod + TypeScript`
- Frontend: `React + socket.io-client + TypeScript + Vite`

## Rodar local

1. Instale dependências:

```bash
npm --prefix backend install
npm --prefix frontend install
```

2. Crie os arquivos `.env` com base no `.env.example` de cada app.

3. Gere o client Prisma e aplique schema:

```bash
npm --prefix backend run prisma:generate
npm --prefix backend run prisma:push
```

4. Rode backend e frontend em terminais separados:

```bash
npm --prefix backend run dev
npm --prefix frontend run dev
```

## Endpoints HTTP principais

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/characters`
- `GET /api/characters/me`
- `GET /api/world/state`

## Eventos Socket.IO

### Cliente -> Servidor

- `player:move` payload `{ direction: "up" | "down" | "left" | "right" | null }`

### Servidor -> Cliente

- `session:ready`
- `world:update`
