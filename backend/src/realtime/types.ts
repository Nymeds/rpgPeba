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
