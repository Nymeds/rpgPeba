export type Direction = "up" | "down" | "left" | "right";

export type InventorySlot = string | null;

export type Account = {
  id: number;
  username: string;
};

export type Character = {
  id: number;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  inventory: InventorySlot[];
};

export type AuthResponse = {
  token: string;
  account: Account;
  character: Character | null;
};

export type PublicPlayer = {
  id: number;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  inventory: InventorySlot[];
  online: boolean;
};

export type WorldUpdatePayload = {
  mapSize: number;
  tick: number;
  players: PublicPlayer[];
};

export type SessionReadyPayload = {
  playerId: number;
  playerName: string;
  mapSize: number;
};

export type SocketAck = (response: { ok: boolean; error?: string }) => void;

export type ServerToClientEvents = {
  "session:ready": (payload: SessionReadyPayload) => void;
  "world:update": (payload: WorldUpdatePayload) => void;
};

export type ClientToServerEvents = {
  "player:move": (payload: { direction: Direction | null }, ack?: SocketAck) => void;
};
