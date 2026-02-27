import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

import { criarSocketJogo } from "../socket";
import type {
  ClientToServerEvents,
  Direction,
  ServerToClientEvents,
  SessionReadyPayload,
  WorldUpdatePayload
} from "../types";

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export function useGameSocket(token: string | null, enabled: boolean) {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [session, setSession] = useState<SessionReadyPayload | null>(null);
  const [world, setWorld] = useState<WorldUpdatePayload | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !enabled) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSession(null);
      setWorld(null);
      setStatus("idle");
      setError(null);
      return;
    }

    const socket = criarSocketJogo(token);
    socketRef.current = socket;
    setStatus("connecting");
    setError(null);

    socket.on("connect", () => {
      setStatus("connected");
      setError(null);
      console.log(`[CLIENT][socket] conectado socket=${socket.id}`);
    });

    socket.on("session:ready", (payload) => {
      setSession(payload);
      console.log(`[CLIENT][socket] sessao pronta player=${payload.playerName}(${payload.playerId})`);
    });

    socket.on("world:update", (payload) => {
      setWorld(payload);
    });

    socket.on("connect_error", (socketError) => {
      setStatus("error");
      setError(socketError.message);
      console.error("[CLIENT][socket] connect_error", socketError);
    });

    socket.on("disconnect", (reason) => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      setStatus("idle");
      console.warn(`[CLIENT][socket] disconnect reason=${reason}`);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [enabled, token]);

  const sendMove = useCallback((direction: Direction | null) => {
    const socket = socketRef.current;
    if (!socket) {
      return;
    }

    socket.emit("player:move", { direction }, (ack) => {
      if (!ack.ok) {
        console.warn(`[CLIENT][socket] player:move rejeitado: ${ack.error ?? "erro desconhecido"}`);
      }
    });
  }, []);

  return {
    session,
    world,
    status,
    error,
    sendMove
  };
}
