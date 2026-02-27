import type { FastifyInstance } from "fastify";
import { Server as SocketIOServer } from "socket.io";

import { MAP_SIZE } from "../game.js";
import { applyMovement, buildPublicPlayersSnapshot } from "./world.js";

const TICK_RATE = 20;
const TICK_INTERVAL_MS = 1000 / TICK_RATE;
const MOVE_SPEED_TILES_PER_SECOND = 5;
const LOOP_LOG_INTERVAL_MS = 250;
const LOOP_SUMMARY_INTERVAL_TICKS = TICK_RATE;

type WorldUpdatePayload = {
  mapSize: number;
  tick: number;
  players: ReturnType<typeof buildPublicPlayersSnapshot>;
};

export function emitWorldUpdate(io: SocketIOServer, tick: number): void {
  const payload: WorldUpdatePayload = {
    mapSize: MAP_SIZE,
    tick,
    players: buildPublicPlayersSnapshot()
  };

  io.emit("world:update", payload);
}

export function startGameLoop(app: FastifyInstance, io: SocketIOServer): () => void {
  let tick = 0;
  let lastTickAt = Date.now();
  const lastMovementLogAtBySocket = new Map<string, number>();

  const intervalHandle = setInterval(() => {
    const now = Date.now();
    const rawDeltaSeconds = (now - lastTickAt) / 1000;
    const deltaSeconds = Math.min(rawDeltaSeconds, 0.25);
    lastTickAt = now;

    const movements = applyMovement(deltaSeconds, MOVE_SPEED_TILES_PER_SECOND);

    if (tick % LOOP_SUMMARY_INTERVAL_TICKS === 0 && movements.length > 0) {
      app.log.info(`[loop] tick=${tick} movendo=${movements.length} player(s) dt=${deltaSeconds.toFixed(3)}s`);
    }

    for (const move of movements) {
      const lastLogAt = lastMovementLogAtBySocket.get(move.socketId) ?? 0;
      if (now - lastLogAt < LOOP_LOG_INTERVAL_MS) {
        continue;
      }
      lastMovementLogAtBySocket.set(move.socketId, now);

      app.log.info(
        [
          "[loop] move",
          `player=${move.playerName}`,
          `dir=${move.direction}`,
          `from=(${move.fromX.toFixed(2)},${move.fromY.toFixed(2)})`,
          `to=(${move.toX.toFixed(2)},${move.toY.toFixed(2)})`,
          `dt=${move.deltaSeconds.toFixed(3)}`,
          "eq: posNova = clamp(posAtual + direcao * velocidade * delta)"
        ].join(" | ")
      );
    }

    tick += 1;
    emitWorldUpdate(io, tick);
  }, TICK_INTERVAL_MS);

  return () => {
    clearInterval(intervalHandle);
  };
}
