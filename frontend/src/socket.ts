import { io, type Socket } from "socket.io-client";

import { WS_URL } from "./api";
import type { ClientToServerEvents, ServerToClientEvents } from "./types";

export function criarSocketChat(nickname: string): Socket<ServerToClientEvents, ClientToServerEvents> {
  return io(WS_URL, {
    transports: ["websocket"],
    auth: { nickname }
  });
}
