export type Direction = "up" | "down" | "left" | "right";

export type MoveInput = {
  x: number;
  y: number;
};

export type SocketAck = (response: { ok: boolean; error?: string }) => void;

export type SessionReadyPayload = {
  playerId: number;
  playerName: string;
  mapSize: number;
};
