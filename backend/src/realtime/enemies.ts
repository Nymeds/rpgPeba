import { MAP_SIZE, limitarAoMapa } from "../game.js";
import { buildEnemyAwarePlayersSnapshot, buildPublicPlayersSnapshot, damagePlayer, healPlayer } from "./world.js";
import type { Direction } from "./types.js";
import {
  AI_CHAT_HOLD_RADIUS,
  AI_FAKE_ATTACK_CHANCE_PER_TICK,
  AI_FAKE_ATTACK_COOLDOWN_MS,
  AI_FOLLOW_DISTANCE,
  AI_IDLE_MAX_MS,
  AI_IDLE_MIN_MS,
  AI_SPAWN_ID,
  AI_WANDER_IDLE_CHANCE,
  AI_WANDER_MAX_MS,
  AI_WANDER_MIN_MS,
  EnemyAiDirector
} from "./enemyAi.js";

const ENEMY_SPAWN_RADIUS = 10;
const ENEMY_CHASE_RADIUS = 5;
const ENEMY_LOSE_TRACK_RADIUS = 6;
const ENEMY_ATTACK_DISTANCE = 0.5;
const ENEMY_RESPAWN_DELAY_MS = 5000;
const ENEMY_ATTACK_COOLDOWN_MS = 400;
const ENEMY_ATTACK_DAMAGE = 20;
const ENEMY_ATTACK_ANIMATION_MS = 400;
const MONK_SUPPORT_HEAL_AMOUNT = 14;
const MONK_SUPPORT_COOLDOWN_MS = 1200;

export type EnemyType = "WARRIOR" | "MONK";
export type AiDisposition = "friendly" | "neutral" | "hostile";
export type AiPersonaId = "FALLEN_KNIGHT" | "LAST_MONK";

export type EnemySpawnDefinition = {
  id: string;
  name: string;
  x: number;
  y: number;
  enemyType: EnemyType;
  spawnCount: number;
};

export type OnlineEnemyState = {
  id: number;
  spawnId: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  enemyType: EnemyType;
  facing: Direction;
  inputX: number;
  inputY: number;
  moving: boolean;
  spawnX: number;
  spawnY: number;
  targetPlayerId: number | null;
  lastAttackAtMs: number;
  lastTargetChangeAtMs: number;
  deadUntilMs: number | null;
  dirtyState: boolean;
  isAttacking: boolean;
  attackStartedAtMs: number;
  isAiCompanion: boolean;
  aiPersonaId: AiPersonaId | null;
  allyEnemyId: number | null;
  followPlayerId: number | null;
  aiDisposition: AiDisposition;
  recentMemory: string[];
  lastAiInteractionAtMs: number;
  pauseUntilMs: number;
  idleUntilMs: number;
  wanderUntilMs: number;
  lastFakeAttackAtMs: number;
};

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
};

export type EnemyAttackResult = {
  enemyId: number;
  enemyName: string;
  targetId: number;
  targetName: string;
  amount: number;
  targetHp: number;
  targetDied: boolean;
  effect: "damage" | "heal";
};

const DATA_BY_SPAWN = new Map<string, OnlineEnemyState[]>();
let nextEnemyId = 10000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function generateRandomName(): string {
  const prefixes = ["Goblin", "Orc", "Troll", "Kobold", "Skeleton"];
  const suffixes = ["Slayer", "Bane", "Fang", "Claw", "Maw"];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  const number = Math.floor(Math.random() * 999);
  return `${prefix}${suffix}${number}`;
}

function normalizeVector(x: number, y: number): { x: number; y: number; length: number } {
  const length = Math.hypot(x, y);
  if (length < 0.0001) {
    return { x: 0, y: 0, length: 0 };
  }
  return {
    x: x / length,
    y: y / length,
    length
  };
}

function directionFromInput(x: number, y: number, fallback: Direction): Direction {
  if (Math.abs(x) >= Math.abs(y) && Math.abs(x) > 0.0001) {
    return x < 0 ? "left" : "right";
  }
  if (Math.abs(y) > 0.0001) {
    return y < 0 ? "up" : "down";
  }
  return fallback;
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomNearbyPosition(baseX: number, baseY: number): { x: number; y: number } {
  const options = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1]
  ];
  const [offsetX, offsetY] = options[Math.floor(Math.random() * options.length)] ?? [1, 0];
  return {
    x: clamp(baseX + offsetX, 1, MAP_SIZE - 2),
    y: clamp(baseY + offsetY, 1, MAP_SIZE - 2)
  };
}

function randomCompanionSpawn(): { x: number; y: number } {
  const margin = 2;
  return {
    x: randomInt(margin, MAP_SIZE - margin - 1),
    y: randomInt(margin, MAP_SIZE - margin - 1)
  };
}

function createEnemyState(input: {
  spawnId: string;
  name: string;
  x: number;
  y: number;
  enemyType: EnemyType;
  isAiCompanion: boolean;
  aiPersonaId: AiPersonaId | null;
  maxHp?: number;
}): OnlineEnemyState {
  const maxHp = input.maxHp ?? 50;
  return {
    id: nextEnemyId++,
    spawnId: input.spawnId,
    name: input.name,
    x: input.x,
    y: input.y,
    hp: maxHp,
    maxHp,
    enemyType: input.enemyType,
    facing: "down",
    inputX: 0,
    inputY: 0,
    moving: false,
    spawnX: input.x,
    spawnY: input.y,
    targetPlayerId: null,
    lastAttackAtMs: 0,
    lastTargetChangeAtMs: 0,
    deadUntilMs: null,
    dirtyState: true,
    isAttacking: false,
    attackStartedAtMs: 0,
    isAiCompanion: input.isAiCompanion,
    aiPersonaId: input.aiPersonaId,
    allyEnemyId: null,
    followPlayerId: null,
    aiDisposition: "neutral",
    recentMemory: [],
    lastAiInteractionAtMs: 0,
    pauseUntilMs: 0,
    idleUntilMs: 0,
    wanderUntilMs: 0,
    lastFakeAttackAtMs: 0
  };
}

function createAiCompanionPair(): [OnlineEnemyState, OnlineEnemyState] {
  const origin = randomCompanionSpawn();
  const monkPosition = randomNearbyPosition(origin.x, origin.y);

  const fallenKnight = createEnemyState({
    spawnId: AI_SPAWN_ID,
    name: "FallenKnight",
    x: origin.x,
    y: origin.y,
    enemyType: "WARRIOR",
    isAiCompanion: true,
    aiPersonaId: "FALLEN_KNIGHT",
    maxHp: 60
  });

  const lastMonk = createEnemyState({
    spawnId: AI_SPAWN_ID,
    name: "LastMonk",
    x: monkPosition.x,
    y: monkPosition.y,
    enemyType: "MONK",
    isAiCompanion: true,
    aiPersonaId: "LAST_MONK",
    maxHp: 55
  });

  fallenKnight.allyEnemyId = lastMonk.id;
  lastMonk.allyEnemyId = fallenKnight.id;
  return [fallenKnight, lastMonk];
}

const enemyAiDirector = new EnemyAiDirector({
  getAllEnemies: () => getAllEnemies(),
  getPlayersSnapshot: () => buildPublicPlayersSnapshot()
});

function getEnemyById(enemyId: number): OnlineEnemyState | null {
  for (const list of DATA_BY_SPAWN.values()) {
    const enemy = list.find((entry) => entry.id === enemyId);
    if (enemy) {
      return enemy;
    }
  }

  return null;
}

export function registerEnemySpawns(spawns: EnemySpawnDefinition[]): void {
  DATA_BY_SPAWN.clear();
  enemyAiDirector.reset(Date.now());
  nextEnemyId = 10000;

  for (const spawn of spawns) {
    DATA_BY_SPAWN.set(spawn.id, []);

    for (let i = 0; i < spawn.spawnCount; i += 1) {
      const enemy = createEnemyState({
        spawnId: spawn.id,
        name: generateRandomName(),
        x: spawn.x,
        y: spawn.y,
        enemyType: spawn.enemyType,
        isAiCompanion: false,
        aiPersonaId: null
      });
      DATA_BY_SPAWN.get(spawn.id)?.push(enemy);
    }
  }

  const companions = createAiCompanionPair();
  DATA_BY_SPAWN.set(AI_SPAWN_ID, companions);
  enemyAiDirector.onCompanionsInitialized(companions);
}

export function getEnemiesBySpawn(spawnId: string): OnlineEnemyState[] {
  return DATA_BY_SPAWN.get(spawnId) ?? [];
}

export function getAllEnemies(): OnlineEnemyState[] {
  const all: OnlineEnemyState[] = [];
  for (const enemies of DATA_BY_SPAWN.values()) {
    all.push(...enemies);
  }
  return all;
}

export function handlePlayerChatForAi(playerId: number, playerName: string, text: string): void {
  enemyAiDirector.handlePlayerChatForAi(playerId, playerName, text);
}

export function tickAiCompanionDirector(nowMs = Date.now()): void {
  enemyAiDirector.tickAiCompanionDirector(nowMs);
}

export function consumePendingAiChatMessages(
  nowMs = Date.now()
): Array<{ enemyId: number; enemyName: string; text: string }> {
  return enemyAiDirector.consumePendingAiChatMessages(nowMs);
}

export function updateEnemyTargets(
  playerPositions: Array<{ characterId: number; x: number; y: number; isSpawnProtected: boolean }>,
  attackedByPlayerId: (enemyId: number) => number | null
): void {
  const playersById = new Map(playerPositions.map((player) => [player.characterId, player]));
  for (const enemies of DATA_BY_SPAWN.values()) {
    for (const enemy of enemies) {
      if (enemy.deadUntilMs !== null && enemy.deadUntilMs > Date.now()) {
        continue;
      }

      const now = Date.now();
      const lastAttackerId = attackedByPlayerId(enemy.id);

      if (enemy.isAiCompanion) {
        enemyAiDirector.updateCompanionTargeting(enemy, playerPositions, lastAttackerId, now);
        continue;
      }

      if (lastAttackerId !== null) {
        const lastAttacker = playersById.get(lastAttackerId);
        if (lastAttacker && !lastAttacker.isSpawnProtected) {
          enemy.targetPlayerId = lastAttackerId;
          enemy.lastTargetChangeAtMs = now;
        }
      }

      if (enemy.targetPlayerId !== null) {
        const targetPlayer = playersById.get(enemy.targetPlayerId);
        if (!targetPlayer || targetPlayer.isSpawnProtected) {
          enemy.targetPlayerId = null;
          continue;
        }

        const dist = Math.hypot(targetPlayer.x - enemy.x, targetPlayer.y - enemy.y);
        if (dist > ENEMY_LOSE_TRACK_RADIUS) {
          enemy.targetPlayerId = null;
        }
      }

      if (enemy.targetPlayerId === null) {
        for (const player of playerPositions) {
          if (player.isSpawnProtected) {
            continue;
          }
          const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
          if (dist <= ENEMY_CHASE_RADIUS) {
            enemy.targetPlayerId = player.characterId;
            break;
          }
        }
      }
    }
  }
}

export function applyEnemyMovement(
  deltaSeconds: number,
  playerPositions: Array<{ characterId: number; x: number; y: number }>,
  tileSolido: (x: number, y: number) => boolean
): void {
  const defaultMoveSpeed = 2.5;
  const enemiesById = new Map(getAllEnemies().map((enemy) => [enemy.id, enemy]));

  for (const enemies of DATA_BY_SPAWN.values()) {
    for (const enemy of enemies) {
      const nowMs = Date.now();
      if ((enemy.deadUntilMs !== null && enemy.deadUntilMs > nowMs) || enemy.isAttacking) {
        enemy.inputX = 0;
        enemy.inputY = 0;
        continue;
      }

      if (enemy.isAiCompanion && nowMs < enemy.pauseUntilMs) {
        const wasMoving = enemy.moving;
        enemy.inputX = 0;
        enemy.inputY = 0;
        enemy.moving = false;
        if (wasMoving !== enemy.moving) {
          enemy.dirtyState = true;
        }
        continue;
      }

      let targetX = 0;
      let targetY = 0;
      const nearestPlayerDistance = enemy.isAiCompanion
        ? playerPositions.reduce((minDist, player) => {
            const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
            return Math.min(minDist, dist);
          }, Number.POSITIVE_INFINITY)
        : Number.POSITIVE_INFINITY;
      const shouldHoldForConversation =
        enemy.isAiCompanion &&
        enemy.targetPlayerId === null &&
        enemy.followPlayerId === null &&
        nearestPlayerDistance <= AI_CHAT_HOLD_RADIUS;

      if (enemy.targetPlayerId !== null) {
        const targetPlayer = playerPositions.find((p) => p.characterId === enemy.targetPlayerId);
        if (targetPlayer) {
          const dx = targetPlayer.x - enemy.x;
          const dy = targetPlayer.y - enemy.y;
          const dist = Math.hypot(dx, dy);

          if (dist <= ENEMY_ATTACK_DISTANCE) {
            targetX = 0;
            targetY = 0;
          } else {
            const normalized = normalizeVector(dx, dy);
            targetX = normalized.x;
            targetY = normalized.y;
          }
        }
      } else if (enemy.isAiCompanion && enemy.followPlayerId !== null) {
        const followedPlayer = playerPositions.find((p) => p.characterId === enemy.followPlayerId);
        if (followedPlayer) {
          const dx = followedPlayer.x - enemy.x;
          const dy = followedPlayer.y - enemy.y;
          const dist = Math.hypot(dx, dy);
          if (dist > AI_FOLLOW_DISTANCE) {
            const normalized = normalizeVector(dx, dy);
            targetX = normalized.x;
            targetY = normalized.y;
          }
        }
      } else if (enemy.isAiCompanion && enemy.allyEnemyId !== null) {
        const ally = enemiesById.get(enemy.allyEnemyId) ?? null;
        if (ally && ally.deadUntilMs === null) {
          const dx = ally.x - enemy.x;
          const dy = ally.y - enemy.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 2.4) {
            const normalized = normalizeVector(dx, dy);
            targetX = normalized.x;
            targetY = normalized.y;
          }
        }
      }

      if (targetX === 0 && targetY === 0 && enemy.isAiCompanion) {
        if (shouldHoldForConversation) {
          enemy.idleUntilMs = Math.max(enemy.idleUntilMs, nowMs + randomInt(900, 1700));
          enemy.wanderUntilMs = enemy.idleUntilMs;
          targetX = 0;
          targetY = 0;
        } else {
        const distFromSpawn = Math.hypot(enemy.x - enemy.spawnX, enemy.y - enemy.spawnY);
        if (distFromSpawn > ENEMY_SPAWN_RADIUS + 2) {
          const backToOrigin = normalizeVector(enemy.spawnX - enemy.x, enemy.spawnY - enemy.y);
          targetX = backToOrigin.x;
          targetY = backToOrigin.y;
        } else if (nowMs < enemy.idleUntilMs) {
          targetX = 0;
          targetY = 0;
        } else {
          if (nowMs >= enemy.wanderUntilMs) {
            const shouldIdleNow = Math.random() < AI_WANDER_IDLE_CHANCE;
            if (shouldIdleNow) {
              enemy.idleUntilMs = nowMs + randomInt(AI_IDLE_MIN_MS, AI_IDLE_MAX_MS);
              enemy.wanderUntilMs = enemy.idleUntilMs;
              targetX = 0;
              targetY = 0;
            } else {
              enemy.wanderUntilMs = nowMs + randomInt(AI_WANDER_MIN_MS, AI_WANDER_MAX_MS);
              const angle = Math.random() * Math.PI * 2;
              targetX = Math.cos(angle);
              targetY = Math.sin(angle);
              enemy.inputX = targetX;
              enemy.inputY = targetY;
            }
          } else {
            targetX = enemy.inputX;
            targetY = enemy.inputY;
          }
        }
        }
      }

      if (targetX === 0 && targetY === 0 && !enemy.isAiCompanion) {
        const distFromSpawn = Math.hypot(enemy.x - enemy.spawnX, enemy.y - enemy.spawnY);
        if (distFromSpawn > ENEMY_SPAWN_RADIUS - 1 || Math.random() < 0.02) {
          const angleDelta = (Math.random() - 0.5) * Math.PI;
          const currentAngle = Math.atan2(enemy.inputY, enemy.inputX);
          const newAngle = currentAngle + angleDelta;
          targetX = Math.cos(newAngle);
          targetY = Math.sin(newAngle);
        } else {
          targetX = enemy.inputX;
          targetY = enemy.inputY;
        }
      }

      enemy.inputX = clamp(targetX, -1, 1);
      enemy.inputY = clamp(targetY, -1, 1);

      const prevX = enemy.x;
      const prevY = enemy.y;
      const moveSpeed = enemy.isAiCompanion ? 1.8 : defaultMoveSpeed;

      const newX = enemy.x + enemy.inputX * moveSpeed * deltaSeconds;
      const newY = enemy.y + enemy.inputY * moveSpeed * deltaSeconds;

      if (!tileSolido(Math.round(newX), Math.round(newY))) {
        enemy.x = limitarAoMapa(newX);
        enemy.y = limitarAoMapa(newY);
      }

      enemy.facing = directionFromInput(enemy.inputX, enemy.inputY, enemy.facing);

      const wasMoving = enemy.moving;
      enemy.moving = Math.hypot(enemy.x - prevX, enemy.y - prevY) > 0.001;
      if (enemy.moving !== wasMoving) {
        enemy.dirtyState = true;
      }
    }
  }
}

export function applyEnemyAttacks(nowMs = Date.now()): EnemyAttackResult[] {
  const hits: EnemyAttackResult[] = [];
  const playerSnapshots = buildPublicPlayersSnapshot();
  const playerById = new Map(playerSnapshots.map((player) => [player.id, player]));
  const enemyAwarePlayers = buildEnemyAwarePlayersSnapshot(nowMs);
  const spawnProtectionByPlayerId = new Map(
    enemyAwarePlayers.map((player) => [player.characterId, player.isSpawnProtected])
  );

  for (const enemies of DATA_BY_SPAWN.values()) {
    for (const enemy of enemies) {
      if (enemy.deadUntilMs !== null || enemy.hp <= 0) {
        continue;
      }

      if (enemy.isAttacking) {
        const elapsedSinceAttack = nowMs - enemy.attackStartedAtMs;
        if (elapsedSinceAttack < ENEMY_ATTACK_ANIMATION_MS) {
          continue;
        }

        enemy.isAttacking = false;
        enemy.lastAttackAtMs = nowMs;
      }

      if (
        enemy.isAiCompanion &&
        enemy.targetPlayerId === null &&
        nowMs >= enemy.pauseUntilMs &&
        nowMs - enemy.lastFakeAttackAtMs >= AI_FAKE_ATTACK_COOLDOWN_MS &&
        Math.random() < AI_FAKE_ATTACK_CHANCE_PER_TICK
      ) {
        enemy.isAttacking = true;
        enemy.attackStartedAtMs = nowMs;
        enemy.lastFakeAttackAtMs = nowMs;
        enemy.dirtyState = true;
        continue;
      }

      if (enemy.isAiCompanion && nowMs < enemy.pauseUntilMs) {
        continue;
      }

      if (
        enemy.isAiCompanion &&
        enemy.enemyType === "MONK" &&
        enemy.aiDisposition === "friendly" &&
        enemy.followPlayerId !== null
      ) {
        const supportTarget = playerById.get(enemy.followPlayerId);
        if (!supportTarget) {
          continue;
        }

        const dist = Math.hypot(supportTarget.x - enemy.x, supportTarget.y - enemy.y);
        const cooldownMs = nowMs - enemy.lastAttackAtMs;
        if (
          supportTarget.hp < supportTarget.maxHp &&
          dist <= AI_FOLLOW_DISTANCE &&
          cooldownMs >= MONK_SUPPORT_COOLDOWN_MS
        ) {
          enemy.isAttacking = true;
          enemy.attackStartedAtMs = nowMs;
          const healResult = healPlayer(supportTarget.id, MONK_SUPPORT_HEAL_AMOUNT);
          if (healResult !== null) {
            hits.push({
              enemyId: enemy.id,
              enemyName: enemy.name,
              targetId: supportTarget.id,
              targetName: supportTarget.name,
              amount: healResult.healedAmount,
              targetHp: healResult.newHp,
              targetDied: false,
              effect: "heal"
            });
            enemy.dirtyState = true;
          }
        }
        continue;
      }

      if (enemy.targetPlayerId === null) {
        continue;
      }

      const cooldownMs = nowMs - enemy.lastAttackAtMs;
      if (cooldownMs < ENEMY_ATTACK_COOLDOWN_MS) {
        continue;
      }

      const targetPlayer = playerById.get(enemy.targetPlayerId);
      if (!targetPlayer) {
        enemy.targetPlayerId = null;
        continue;
      }
      if (spawnProtectionByPlayerId.get(targetPlayer.id) === true) {
        enemy.targetPlayerId = null;
        continue;
      }

      const dist = Math.hypot(targetPlayer.x - enemy.x, targetPlayer.y - enemy.y);
      if (dist > ENEMY_ATTACK_DISTANCE) {
        continue;
      }

      enemy.isAttacking = true;
      enemy.attackStartedAtMs = nowMs;

      const damageResult = damagePlayer(enemy.targetPlayerId, ENEMY_ATTACK_DAMAGE);
      if (damageResult === null) {
        enemy.targetPlayerId = null;
        continue;
      }

      hits.push({
        enemyId: enemy.id,
        enemyName: enemy.name,
        targetId: enemy.targetPlayerId,
        targetName: targetPlayer.name,
        amount: damageResult.damageTaken,
        targetHp: damageResult.newHp,
        targetDied: damageResult.died,
        effect: "damage"
      });

      enemy.dirtyState = true;
    }
  }

  return hits;
}

export function applyEnemyRespawns(nowMs = Date.now()): Array<{ spawnId: string; enemyId: number; enemyName: string; x: number; y: number }> {
  const respawns: Array<{ spawnId: string; enemyId: number; enemyName: string; x: number; y: number }> = [];

  for (const [spawnId, enemies] of DATA_BY_SPAWN.entries()) {
    for (const enemy of enemies) {
      if (enemy.deadUntilMs === null) {
        continue;
      }

      if (enemy.deadUntilMs > nowMs) {
        continue;
      }

      if (enemy.isAiCompanion) {
        const ally = enemy.allyEnemyId !== null ? getEnemyById(enemy.allyEnemyId) : null;
        if (ally && ally.deadUntilMs === null) {
          const near = randomNearbyPosition(Math.round(ally.x), Math.round(ally.y));
          enemy.spawnX = near.x;
          enemy.spawnY = near.y;
        } else {
          const randomSpawn = randomCompanionSpawn();
          enemy.spawnX = randomSpawn.x;
          enemy.spawnY = randomSpawn.y;
        }
      }

      enemy.deadUntilMs = null;
      enemy.hp = enemy.maxHp;
      enemy.x = enemy.spawnX;
      enemy.y = enemy.spawnY;
      enemy.inputX = 0;
      enemy.inputY = 0;
      enemy.targetPlayerId = null;
      enemy.followPlayerId = null;
      enemy.aiDisposition = "neutral";
      enemy.isAttacking = false;
      enemy.attackStartedAtMs = 0;
      enemy.pauseUntilMs = 0;
      enemy.idleUntilMs = 0;
      enemy.wanderUntilMs = 0;
      enemy.lastFakeAttackAtMs = 0;
      enemy.dirtyState = true;

      respawns.push({
        spawnId,
        enemyId: enemy.id,
        enemyName: enemy.name,
        x: enemy.x,
        y: enemy.y
      });
    }
  }

  return respawns;
}

export function damageEnemy(
  enemyId: number,
  damageAmount: number,
  attacker: { characterId: number; x: number; y: number }
): boolean {
  for (const enemies of DATA_BY_SPAWN.values()) {
    const enemy = enemies.find((entry) => entry.id === enemyId);
    if (!enemy) {
      continue;
    }

    if (enemy.deadUntilMs !== null || enemy.hp <= 0) {
      return false;
    }

    enemy.targetPlayerId = attacker.characterId;
    enemy.lastTargetChangeAtMs = Date.now();

    if (enemy.isAiCompanion) {
      enemyAiDirector.registerCompanionAttack(enemy, attacker.characterId, Date.now());
    }

    enemy.hp = Math.max(0, enemy.hp - damageAmount);
    const died = enemy.hp === 0;

    if (died) {
      enemy.deadUntilMs = Date.now() + ENEMY_RESPAWN_DELAY_MS;
      enemy.targetPlayerId = null;
      enemy.followPlayerId = null;
      enemy.isAttacking = false;

      enemyAiDirector.registerPlayerKill(attacker.characterId);

      if (enemy.isAiCompanion) {
        enemyAiDirector.queueCompanionDeathMessage(enemy);
      }
    }

    enemy.dirtyState = true;
    return true;
  }

  return false;
}

export function buildPublicEnemiesSnapshot(): PublicEnemy[] {
  const nowMs = Date.now();
  const enemies: PublicEnemy[] = [];

  for (const list of DATA_BY_SPAWN.values()) {
    for (const enemy of list) {
      if (enemy.deadUntilMs !== null && enemy.deadUntilMs > nowMs) {
        continue;
      }

      enemies.push({
        id: enemy.id,
        name: enemy.name,
        x: enemy.x,
        y: enemy.y,
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        enemyType: enemy.enemyType,
        isAttacking: enemy.isAttacking,
        isAiCompanion: enemy.isAiCompanion
      });
    }
  }

  return enemies.sort((a, b) => a.id - b.id);
}
