export type Direction = "up" | "down" | "left" | "right";

export enum PlayerType {
  WARRIOR = "WARRIOR",
  MAGE = "MAGE",
  ARCHER = "ARCHER"
}

export type InventorySlot = string | null;

export type MoveInput = {
  x: number;
  y: number;
};

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
  playerType: PlayerType;
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
  playerType: PlayerType;
};

export type PublicAttack = {
  id: number;
  ownerId: number;
  x: number;
  y: number;
  size: number;
  expiresAt: number;
};

export type WorldUpdatePayload = {
  mapSize: number;
  tick: number;
  players: PublicPlayer[];
  attacks: PublicAttack[];
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
  "player:move": (payload: MoveInput, ack?: SocketAck) => void;
  atack: (payload: { x: number; y: number; range: number }, ack?: SocketAck) => void;
};
