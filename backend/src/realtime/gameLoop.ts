import { Server as SocketIOServer } from "socket.io";

import { MAP_SIZE } from "../game.js";
import { logError, logInfo } from "../logger.js";
import { appendSystemChatMessage } from "./chat.js";
import { consumirSinalMapaAtualizado, obterMapRevision } from "./mapEditor.js";
import {
  applyAttackDamage,
  applyMovement,
  applyRespawns,
  buildPublicAttacksSnapshot,
  buildPublicPlayersSnapshot
} from "./world.js";

const TICK_RATE = 20;
const TICK_INTERVAL_MS = 1000 / TICK_RATE;
const MOVE_SPEED_TILES_PER_SECOND = 3;
const LOOP_LOG_INTERVAL_MS = 250;
const LOOP_SUMMARY_INTERVAL_TICKS = TICK_RATE;

type WorldUpdatePayload = {
  mapSize: number;
  tick: number;
  mapRevision: number;
  players: ReturnType<typeof buildPublicPlayersSnapshot>;
  attacks: ReturnType<typeof buildPublicAttacksSnapshot>;
};

export function emitWorldUpdate(io: SocketIOServer, tick: number): void {
  const nowMs = Date.now();
  const payload: WorldUpdatePayload = {
    mapSize: MAP_SIZE,
    tick,
    mapRevision: obterMapRevision(), //visualizacao de mudancas no mapa
    players: buildPublicPlayersSnapshot(),
    attacks: buildPublicAttacksSnapshot(nowMs)
  };

  io.emit("world:update", payload);
}

export function startGameLoop(io: SocketIOServer): () => void {
  let tick = 0;
  let lastTickAt = Date.now();
  const lastMovementLogAtBySocket = new Map<string, number>();

  logInfo("LOOP", "Iniciado", {
    tickRate: TICK_RATE,
    speed: MOVE_SPEED_TILES_PER_SECOND,
    formula: "posNova=clamp(posAtual+direcao*velocidade*delta)"
  });

  const intervalHandle = setInterval(() => {
    const now = Date.now();
    const rawDeltaSeconds = (now - lastTickAt) / 1000;
    const deltaSeconds = Math.min(rawDeltaSeconds, 0.25);
    lastTickAt = now;

    const movements = applyMovement(deltaSeconds, MOVE_SPEED_TILES_PER_SECOND);
    const attackHits = applyAttackDamage(now);
    const respawns = applyRespawns(now);

    if (tick % LOOP_SUMMARY_INTERVAL_TICKS === 0 && movements.length > 0) {
      logInfo("LOOP", "Resumo tick", {
        tick,
        moving: movements.length,
        dt: deltaSeconds.toFixed(3)
      });
    }

    for (const move of movements) {
      const lastLogAt = lastMovementLogAtBySocket.get(move.socketId) ?? 0;
      if (now - lastLogAt < LOOP_LOG_INTERVAL_MS) {
        continue;
      }
      lastMovementLogAtBySocket.set(move.socketId, now);

      logInfo("MOVE", "Movimento aplicado", {
        player: move.playerName,
        vector: `(${move.vectorX.toFixed(2)},${move.vectorY.toFixed(2)})`,
        from: `(${move.fromX.toFixed(2)},${move.fromY.toFixed(2)})`,
        to: `(${move.toX.toFixed(2)},${move.toY.toFixed(2)})`,
        dt: move.deltaSeconds.toFixed(3)
      });
    }

    for (const hit of attackHits) {
      if (hit.effect === "heal") {
        logInfo("ATACK", "Cura aplicada", {
          attackId: hit.attackId,
          owner: hit.ownerName,
          target: hit.targetName,
          targetId: hit.targetCharacterId,
          amount: hit.amount,
          hpAfter: hit.hpAfter
        });
        continue;
      }

      logInfo("ATACK", "Dano aplicado", {
        attackId: hit.attackId,
        owner: hit.ownerName,
        target: hit.targetName,
        targetId: hit.targetCharacterId,
        amount: hit.amount,
        hpAfter: hit.hpAfter,
        dead: hit.targetDied
      });

      if (hit.targetDied) {
        void appendSystemChatMessage(`${hit.targetName} foi derrotado por ${hit.ownerName}.`)
          .then((deathMessage) => {
             //MURYLLO
            io.emit("chat:message", deathMessage);
          })
          .catch((error) => {
            logError("CHAT", "Falha ao registrar mensagem de sistema", {
              target: hit.targetName,
              owner: hit.ownerName,
              error: error instanceof Error ? error.message : "erro desconhecido"
            });
          });
      }
    }

    for (const respawn of respawns) {
      logInfo("RESPAWN", "Player reapareceu", {
        player: respawn.playerName,
        pos: `(${respawn.x},${respawn.y})`
      });
    }

    const houveAtualizacaoMapa = consumirSinalMapaAtualizado();
    if (houveAtualizacaoMapa) {
      logInfo("MAP", "Mapa atualizado e broadcast solicitado");
      emitWorldUpdate(io, tick);
    }

    tick += 1;
   
    emitWorldUpdate(io, tick);
  }, TICK_INTERVAL_MS);

  return () => {
    clearInterval(intervalHandle);
  };
}
