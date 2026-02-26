export type RoomSummary = {
  name: string;
  usersCount: number;
};

export type ChatMessage = {
  id: number;
  author: string;
  text: string;
  createdAt: string;
};

export type SessionReadyPayload = {
  nickname: string;
  rooms: RoomSummary[];
};

export type RoomJoinedPayload = {
  roomName: string;
  users: string[];
  messages: ChatMessage[];
};

export type ChatMessagePayload = {
  roomName: string;
  message: ChatMessage;
};

export type SocketAck = (response: { ok: boolean; error?: string }) => void;

export type ServerToClientEvents = {
  "session:ready": (payload: SessionReadyPayload) => void;
  "room:list": (payload: { rooms: RoomSummary[] }) => void;
  "room:joined": (payload: RoomJoinedPayload) => void;
  "room:left": (payload: { roomName: string }) => void;
  "room:users": (payload: { roomName: string; users: string[] }) => void;
  "chat:new-message": (payload: ChatMessagePayload) => void;
};

export type ClientToServerEvents = {
  "room:create": (payload: { roomName: string }, ack?: SocketAck) => void;
  "room:join": (payload: { roomName: string }, ack?: SocketAck) => void;
  "room:leave": (ack?: SocketAck) => void;
  "chat:send": (payload: { text: string }, ack?: SocketAck) => void;
};
