import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

import { criarSocketJogo } from "../socket";
import type {
  ChatMessagePayload,
  ClientToServerEvents,
  MoveInput,
  ServerToClientEvents,
  SessionReadyPayload,
  WorldUpdatePayload
} from "../types";

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";
type AttackDirectionInput = {
  dirX: number;
  dirY: number;
  range?: number;
};

export function useGameSocket(token: string | null, enabled: boolean) {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [session, setSession] = useState<SessionReadyPayload | null>(null);
  const [world, setWorld] = useState<WorldUpdatePayload | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessagePayload[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !enabled) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSession(null);
      setWorld(null);
      setChatMessages([]);
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
     //MURYLLO
    socket.on("chat:history", (payload) => {
      setChatMessages(payload.messages);
    });
    //MURYLLO
    socket.on("chat:message", (payload) => {
      setChatMessages((current) => {
        if (current.some((entry) => entry.id === payload.id)) {
          return current;
        }

        const next = [...current, payload];
        if (next.length <= 120) {
          return next;
        }
        return next.slice(next.length - 120);
      });
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

  const sendMove = useCallback((input: MoveInput) => {
    const socket = socketRef.current;
    if (!socket) {
      return;
    }
    //ISABELA
    socket.emit("player:move", input);
  }, []);

  const sendAttack = useCallback((input: AttackDirectionInput) => {
    const socket = socketRef.current;
    if (!socket) {
      return;
    }
    //ISABELA
    socket.emit(
      "atack",
      {
        dirX: input.dirX,
        dirY: input.dirY,
        range: input.range ?? 1
      },
      (ack) => {
        if (!ack.ok) {
          console.warn(`[CLIENT][socket] atack rejeitado: ${ack.error ?? "erro desconhecido"}`);
        }
      }
    );
  }, []);

  const sendChat = useCallback((text: string): Promise<{ ok: boolean; error?: string }> => {
    const socket = socketRef.current;
    if (!socket) {
      return Promise.resolve({ ok: false, error: "Socket desconectado." });
    }
    //MURYLLO
    return new Promise((resolve) => {
      socket.emit("chat:send", { text }, (ack) => {
        resolve(ack);
      });
    });
  }, []);

  return {
    session,
    world,
    chatMessages,
    status,
    error,
    sendMove,
    sendAttack,
    sendChat
  };
}
