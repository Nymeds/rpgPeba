export type Direction = "up" | "down" | "left" | "right";

export enum PlayerType {
  WARRIOR = "WARRIOR",
  MONK = "MONK"
}

export type InventorySlot = string | null;

export type MoveInput = {
  x: number;
  y: number;
};

export type Account = {
  id: number;
  username: string;
  playerType: PlayerType;
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
  radius: number;
  kind: "damage" | "heal";
  expiresAt: number;
};

export enum EnemyType {
  WARRIOR = "WARRIOR",
  MONK = "MONK"
}

export type PublicEnemy = {
  id: number;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  enemyType: EnemyType;
  isAttacking: boolean;
  isAiCompanion: boolean;
  isFactionLeader: boolean;
};

export type WorldUpdatePayload = {
  mapSize: number;
  tick: number;
  mapRevision: number;
  players: PublicPlayer[];
  enemies: PublicEnemy[];
  attacks: PublicAttack[];
};

export type SessionReadyPayload = {
  playerId: number;
  playerName: string;
  mapSize: number;
};

export type ChatMessagePayload = {
  id: number;
  playerId: number;
  playerName: string;
  text: string;
  createdAt: number;
};

export type ChatHistoryPayload = {
  messages: ChatMessagePayload[];
};

export type ChatSendPayload = {
  text: string;
};

export type MapObjectDefinition = {
  id: string;
  name: string;
  imageDataUrl: string;
  maskWidth: number;
  maskHeight: number;
  solid: boolean;
  cropX: number | null;
  cropY: number | null;
  cropWidth: number | null;
  cropHeight: number | null;
};

export type MapLayerDefinition = {
  id: string;
  name: string;
  visible: boolean;
  tiles: Array<Array<string | null>>;
};

export type GameMapDefinition = {
  mapKey: string;
  name: string;
  mapSize: number;
  objects: MapObjectDefinition[];
  layers: MapLayerDefinition[];
  enemySpawns?: EnemySpawnDefinition[];
  updatedAt: string;
};

export type EnemySpawnDefinition = {
  id: string;
  name: string;
  x: number;
  y: number;
  enemyType: "WARRIOR" | "MONK";
  spawnCount: number;
  warriorCount?: number;
  monkCount?: number;
};

export type SocketAck = (response: { ok: boolean; error?: string }) => void;

export type ServerToClientEvents = {
  "session:ready": (payload: SessionReadyPayload) => void;
  "world:update": (payload: WorldUpdatePayload) => void;
  "chat:history": (payload: ChatHistoryPayload) => void;
  "chat:message": (payload: ChatMessagePayload) => void;
};

export type ClientToServerEvents = {
  "player:move": (payload: MoveInput, ack?: SocketAck) => void;
  atack: (payload: { dirX: number; dirY: number; range?: number }, ack?: SocketAck) => void;
  "chat:send": (payload: ChatSendPayload, ack?: SocketAck) => void;
};
