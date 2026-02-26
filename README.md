# Dark Room Chat

Chat simples para aula com Socket.IO.

Fluxo:

1. Usuario faz login com nickname.
2. Vai para lobby.
3. Pode criar sala ou entrar em sala existente.
4. Dentro da sala conversa em tempo real.

## Stack

- Backend: `Node.js + Fastify + Socket.IO + Zod + TypeScript`
- Frontend: `React + socket.io-client + TypeScript + Vite`

## Rodar local

1. Instale dependencias:

```bash
npm --prefix backend install
npm --prefix frontend install
```

2. Rode backend e frontend em terminais separados:

```bash
npm --prefix backend run dev
npm --prefix frontend run dev
```

3. Acesse:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`

## Endpoints HTTP

- `GET /health`
- `GET /api/rooms`

## Eventos Socket.IO

### Cliente -> Servidor

- `room:create` payload `{ roomName }`
- `room:join` payload `{ roomName }`
- `room:leave`
- `chat:send` payload `{ text }`

### Servidor -> Cliente

- `session:ready`
- `room:list`
- `room:joined`
- `room:left`
- `room:users`
- `chat:new-message`
