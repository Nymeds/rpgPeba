export type ChatMessage = {
  id: number;
  author: string;
  text: string;
  createdAt: string;
};

export type RoomSummary = {
  name: string;
  usersCount: number;
};

type UserState = {
  nickname: string;
  roomName: string | null;
};

type RoomState = {
  name: string;
  users: Set<string>;
  messages: ChatMessage[];
};

const LIMITE_MENSAGENS_POR_SALA = 100;

let proximaMensagemId = 1;

const usuariosPorSocket = new Map<string, UserState>();
const salas = new Map<string, RoomState>();

function agoraIso(): string {
  return new Date().toISOString();
}

function manterUltimasMensagens(room: RoomState): void {
  while (room.messages.length > LIMITE_MENSAGENS_POR_SALA) {
    room.messages.shift();
  }
}

function obterSalaOuCriar(roomName: string): RoomState {
  const existente = salas.get(roomName);
  if (existente) {
    return existente;
  }

  const sala: RoomState = {
    name: roomName,
    users: new Set<string>(),
    messages: []
  };
  salas.set(roomName, sala);
  return sala;
}

function normalizarComparacao(valor: string): string {
  return valor.toLocaleLowerCase("pt-BR");
}

function nicknameEmUso(nickname: string): boolean {
  const target = normalizarComparacao(nickname);
  for (const user of usuariosPorSocket.values()) {
    if (normalizarComparacao(user.nickname) === target) {
      return true;
    }
  }
  return false;
}

function tornarNicknameUnico(base: string): string {
  if (!nicknameEmUso(base)) {
    return base;
  }

  let sufixo = 2;
  while (nicknameEmUso(`${base}#${sufixo}`)) {
    sufixo += 1;
  }
  return `${base}#${sufixo}`;
}

function ordenarUsuariosDaSala(room: RoomState): string[] {
  return [...room.users]
    .map((socketId) => usuariosPorSocket.get(socketId)?.nickname ?? "")
    .filter((nickname) => nickname.length > 0)
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function limparSalaVazia(roomName: string): void {
  const room = salas.get(roomName);
  if (!room) {
    return;
  }

  if (room.users.size === 0) {
    salas.delete(roomName);
  }
}

export function registrarUsuarioConectado(socketId: string, nicknameBase: string): string {
  const nickname = tornarNicknameUnico(nicknameBase);
  usuariosPorSocket.set(socketId, {
    nickname,
    roomName: null
  });
  return nickname;
}

export function removerUsuarioConectado(socketId: string): { nickname: string; roomName: string | null } | null {
  const user = usuariosPorSocket.get(socketId);
  if (!user) {
    return null;
  }

  const roomName = user.roomName;
  if (roomName) {
    const room = salas.get(roomName);
    room?.users.delete(socketId);
    limparSalaVazia(roomName);
  }

  usuariosPorSocket.delete(socketId);
  return {
    nickname: user.nickname,
    roomName
  };
}

export function obterNicknamePorSocket(socketId: string): string | null {
  return usuariosPorSocket.get(socketId)?.nickname ?? null;
}

export function obterSalaAtual(socketId: string): string | null {
  return usuariosPorSocket.get(socketId)?.roomName ?? null;
}

export function listarSalas(): RoomSummary[] {
  return [...salas.values()]
    .map((room) => ({
      name: room.name,
      usersCount: room.users.size
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export function listarUsuariosSala(roomName: string): string[] {
  const room = salas.get(roomName);
  if (!room) {
    return [];
  }
  return ordenarUsuariosDaSala(room);
}

export function entrarNaSala(socketId: string, roomName: string): {
  roomName: string;
  users: string[];
  messages: ChatMessage[];
  leftRoomName: string | null;
} | null {
  const user = usuariosPorSocket.get(socketId);
  if (!user) {
    return null;
  }

  const leftRoomName = user.roomName;
  if (leftRoomName && leftRoomName !== roomName) {
    const leftRoom = salas.get(leftRoomName);
    leftRoom?.users.delete(socketId);
    limparSalaVazia(leftRoomName);
  }

  const room = obterSalaOuCriar(roomName);
  room.users.add(socketId);
  user.roomName = roomName;

  return {
    roomName,
    users: ordenarUsuariosDaSala(room),
    messages: [...room.messages],
    leftRoomName: leftRoomName && leftRoomName !== roomName ? leftRoomName : null
  };
}

export function sairDaSala(socketId: string): { roomName: string; users: string[] } | null {
  const user = usuariosPorSocket.get(socketId);
  if (!user || !user.roomName) {
    return null;
  }

  const roomName = user.roomName;
  const room = salas.get(roomName);
  user.roomName = null;

  if (!room) {
    return {
      roomName,
      users: []
    };
  }

  room.users.delete(socketId);
  const users = ordenarUsuariosDaSala(room);
  limparSalaVazia(roomName);

  return {
    roomName,
    users
  };
}

export function publicarMensagem(socketId: string, text: string): { roomName: string; message: ChatMessage } | null {
  const user = usuariosPorSocket.get(socketId);
  if (!user || !user.roomName) {
    return null;
  }

  const room = salas.get(user.roomName);
  if (!room) {
    return null;
  }

  const message: ChatMessage = {
    id: proximaMensagemId++,
    author: user.nickname,
    text,
    createdAt: agoraIso()
  };

  room.messages.push(message);
  manterUltimasMensagens(room);

  return {
    roomName: room.name,
    message
  };
}

obterSalaOuCriar("dark_room");
