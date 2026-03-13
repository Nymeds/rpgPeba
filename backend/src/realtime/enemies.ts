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
const NPC_FACTION_MIN_COUNT = 5;
const NPC_FACTION_SIZE = 9;
const NPC_FACTION_CLUSTER_RADIUS = 6.4;
const NPC_FACTION_COMMAND_RADIUS = 14;
const NPC_FACTION_ATTACK_LEASH_RADIUS = 18;
const NPC_FACTION_IDLE_RADIUS = 40;
const NPC_FACTION_DETECTION_RADIUS = 14;
const NPC_FACTION_GUARD_RADIUS = 2.2;
const NPC_FACTION_AGGRO_MEMORY_MS = 9000;
const NPC_CHAT_RADIUS = 4.6;
const NPC_CHAT_INTERVAL_MIN_MS = 9000;
const NPC_CHAT_INTERVAL_MAX_MS = 18000;
const NPC_CHAT_PAUSE_BASE_MS = 800;
const NPC_CHAT_PAUSE_MAX_MS = 2200;
const NPC_SEPARATION_RADIUS = 0.8;
const NPC_SEPARATION_STRENGTH = 0.7;
const NPC_ENCIRCLE_RADIUS_BASE = 1.1;
const NPC_ENCIRCLE_RADIUS_PER_MEMBER = 0.12;
const NPC_ENCIRCLE_MIN_DISTANCE = 0.9;
const NPC_MONK_SUPPORT_HEAL_AMOUNT = 12;
const NPC_MONK_SUPPORT_COOLDOWN_MS = 1400;
const NPC_MONK_SUPPORT_RADIUS = 2.6;
const NPC_MONK_HEAL_RANGE = 1.3;
const NPC_MONK_HEAL_FACING_DOT = 0.2;
const NPC_MONK_AVOID_PLAYER_RADIUS = 3.4;
const NPC_MONK_FLEE_PLAYER_RADIUS = 2.1;
const NPC_MONK_SEEK_KNIGHT_RADIUS = 6.2;
const NPC_FORMATION_REEVAL_MS = 1800;
const NPC_FORMATION_SHIELD_TRIGGER = 3;
const NPC_FORMATION_SHIELD_WINDOW_MS = 2600;
const NPC_FORMATION_SHIELD_DURATION_MS = 5200;
const NPC_FORMATION_CHASE_ON_HIT_MS = 3200;
const NPC_FORMATION_CHASE_DISTANCE = NPC_FACTION_COMMAND_RADIUS;
const NPC_FORMATION_SAFE_DISTANCE = 2.4;
const NPC_FORMATION_ATTACK_DISTANCE = 1.9;
const NPC_FORMATION_MONK_BACK_OFFSET = 1.2;
const NPC_FORMATION_LEADER_BACK_OFFSET = 2.1;
const NPC_FORMATION_LINE_SPACING = 0.8;
const NPC_FORMATION_SLOT_SEARCH_RADIUS = 4;
const NPC_FORMATION_SLOT_HOLD_RADIUS = 0.28;
const NPC_FORMATION_SLOT_SLOW_RADIUS = 1.1;
const NPC_FORMATION_ANCHOR_UPDATE_MS = 350;
const NPC_FORMATION_ANCHOR_MOVE_THRESHOLD = 0.6;
const NPC_FORMATION_ANCHOR_LERP = 0.32;
const NPC_FORMATION_SHIELD_LERP = 0.18;
const NPC_CERCO_ATTACKER_SWAP_MS = 2600;
const NPC_CERCO_ATTACKER_POST_ATTACK_MS = 300;
const NPC_LEADER_SPEED_MULT = 0.75;
const NPC_LEADER_CHASE_DISTANCE = 4.4;
const NPC_LEADER_CHASE_BAND = 0.6;

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
  warriorCount?: number;
  monkCount?: number;
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
  factionId: number | null;
  encircleAngleRad: number;
  lastAttackedByPlayerId: number | null;
  lastAttackedAtMs: number;
  lastSocialChatAtMs: number;
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
  isFactionLeader: boolean;
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

type NpcFactionBehavior = "aggressive" | "neutral";
type NpcFormationMode = "cerco" | "shield_wall" | "ataque";

type NpcFaction = {
  id: number;
  memberIds: number[];
  leaderId: number;
  behavior: NpcFactionBehavior;
  targetPlayerId: number | null;
  formationMode: NpcFormationMode;
  formationUntilMs: number;
  lastCommandAtMs: number;
  formationAnchorX: number;
  formationAnchorY: number;
  formationAnchorTargetX: number;
  formationAnchorTargetY: number;
  formationAnchorUpdatedAtMs: number;
  cercoAttackerId: number | null;
  cercoLastSwitchAtMs: number;
};

type QueuedNpcChatMessage = {
  dueAtMs: number;
  enemyId: number;
  text: string;
};

const DATA_BY_SPAWN = new Map<string, OnlineEnemyState[]>();
const NPC_FACTIONS = new Map<number, NpcFaction>();
const NPC_FACTION_AGGRO_BY_ID = new Map<number, { playerId: number; untilMs: number }>();
const NPC_CHAT_QUEUE: QueuedNpcChatMessage[] = [];
let nextEnemyId = 10000;
let nextFactionId = 1;
let nextNpcChatAtMs = 0;

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

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function computeFormationFrontCenter(
  leader: OnlineEnemyState,
  target: { x: number; y: number },
  mode: NpcFormationMode
): { x: number; y: number } {
  const backDir = normalizeVector(leader.x - target.x, leader.y - target.y);
  const baseDistance = mode === "shield_wall" ? NPC_FORMATION_SAFE_DISTANCE : NPC_FORMATION_ATTACK_DISTANCE;
  return {
    x: target.x + backDir.x * baseDistance,
    y: target.y + backDir.y * baseDistance
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
    lastFakeAttackAtMs: 0,
    factionId: null,
    encircleAngleRad: Math.random() * Math.PI * 2,
    lastAttackedByPlayerId: null,
    lastAttackedAtMs: 0,
    lastSocialChatAtMs: 0
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

function randomFrom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(Math.random() * (i + 1));
    [items[i], items[swapIndex]] = [items[swapIndex], items[i]];
  }
}

function assignNpcFactions(enemies: OnlineEnemyState[]): void {
  NPC_FACTIONS.clear();
  NPC_FACTION_AGGRO_BY_ID.clear();
  nextFactionId = 1;

  for (const enemy of enemies) {
    enemy.factionId = null;
  }

  const candidates = enemies.filter((enemy) => !enemy.isAiCompanion && enemy.deadUntilMs === null && enemy.hp > 0);
  if (candidates.length < NPC_FACTION_MIN_COUNT) {
    return;
  }

  const byId = new Map(candidates.map((enemy) => [enemy.id, enemy]));
  const unassigned = new Set(candidates.map((enemy) => enemy.id));
  const clusters: OnlineEnemyState[][] = [];

  for (const enemy of candidates) {
    if (!unassigned.has(enemy.id)) {
      continue;
    }
    const queue: OnlineEnemyState[] = [enemy];
    unassigned.delete(enemy.id);
    const cluster: OnlineEnemyState[] = [];

    while (queue.length > 0) {
      const current = queue.pop();
      if (!current) {
        break;
      }
      cluster.push(current);
      for (const otherId of Array.from(unassigned)) {
        const other = byId.get(otherId);
        if (!other) {
          continue;
        }
        const dist = Math.hypot(other.x - current.x, other.y - current.y);
        if (dist <= NPC_FACTION_CLUSTER_RADIUS) {
          unassigned.delete(otherId);
          queue.push(other);
        }
      }
    }

    clusters.push(cluster);
  }

  const nowMs = Date.now();
  for (const cluster of clusters) {
    if (cluster.length < NPC_FACTION_MIN_COUNT) {
      continue;
    }
    const shuffled = [...cluster];
    shuffleInPlace(shuffled);

    for (let i = 0; i < shuffled.length; i += NPC_FACTION_SIZE) {
      const members = shuffled.slice(i, i + NPC_FACTION_SIZE);
      if (members.length === 0) {
        continue;
      }
      const leader = randomFrom(members);
      const behavior: NpcFactionBehavior = Math.random() < 0.5 ? "aggressive" : "neutral";
      const factionId = nextFactionId++;
      NPC_FACTIONS.set(factionId, {
        id: factionId,
        memberIds: members.map((member) => member.id),
        leaderId: leader.id,
        behavior,
        targetPlayerId: null,
        formationMode: "cerco",
        formationUntilMs: 0,
        lastCommandAtMs: 0,
        formationAnchorX: leader.x,
        formationAnchorY: leader.y,
        formationAnchorTargetX: leader.x,
        formationAnchorTargetY: leader.y,
        formationAnchorUpdatedAtMs: nowMs,
        cercoAttackerId: null,
        cercoLastSwitchAtMs: 0
      });
      for (const member of members) {
        member.factionId = factionId;
      }
    }
  }
}

function getFactionForEnemy(enemy: OnlineEnemyState): NpcFaction | null {
  if (enemy.factionId === null) {
    return null;
  }
  return NPC_FACTIONS.get(enemy.factionId) ?? null;
}

function refreshFactionLeaders(nowMs: number, enemiesById: Map<number, OnlineEnemyState>): void {
  for (const faction of NPC_FACTIONS.values()) {
    const leader = enemiesById.get(faction.leaderId) ?? null;
    if (leader && leader.deadUntilMs === null && leader.hp > 0) {
      continue;
    }

    const candidates = faction.memberIds
      .map((id) => enemiesById.get(id))
      .filter((member): member is OnlineEnemyState => Boolean(member && member.deadUntilMs === null && member.hp > 0));
    if (candidates.length === 0) {
      continue;
    }
    const nextLeader = randomFrom(candidates);
    faction.leaderId = nextLeader.id;
    NPC_FACTION_AGGRO_BY_ID.delete(faction.id);
    faction.formationMode = "cerco";
    faction.formationUntilMs = 0;
    faction.lastCommandAtMs = nowMs;
    faction.formationAnchorX = nextLeader.x;
    faction.formationAnchorY = nextLeader.y;
    faction.formationAnchorTargetX = nextLeader.x;
    faction.formationAnchorTargetY = nextLeader.y;
    faction.formationAnchorUpdatedAtMs = nowMs;
    faction.cercoAttackerId = null;
    faction.cercoLastSwitchAtMs = nowMs;
  }
}

function refreshFactionAggro(
  nowMs: number,
  enemies: OnlineEnemyState[],
  playersById: Map<number, { isSpawnProtected: boolean }>
): void {
  for (const [factionId, entry] of NPC_FACTION_AGGRO_BY_ID.entries()) {
    if (entry.untilMs <= nowMs) {
      NPC_FACTION_AGGRO_BY_ID.delete(factionId);
    }
  }

  for (const enemy of enemies) {
    if (enemy.factionId === null || enemy.lastAttackedByPlayerId === null) {
      continue;
    }
    if (nowMs - enemy.lastAttackedAtMs > NPC_FACTION_AGGRO_MEMORY_MS) {
      continue;
    }
    const playerState = playersById.get(enemy.lastAttackedByPlayerId);
    if (!playerState || playerState.isSpawnProtected) {
      continue;
    }
    NPC_FACTION_AGGRO_BY_ID.set(enemy.factionId, {
      playerId: enemy.lastAttackedByPlayerId,
      untilMs: nowMs + NPC_FACTION_AGGRO_MEMORY_MS
    });
  }
}

function refreshFactionFormations(
  nowMs: number,
  enemies: OnlineEnemyState[],
  playersById: Map<number, { characterId: number; x: number; y: number; isSpawnProtected: boolean }>
): void {
  const enemiesById = new Map(enemies.map((enemy) => [enemy.id, enemy]));
  for (const faction of NPC_FACTIONS.values()) {
    const leader = enemies.find((enemy) => enemy.id === faction.leaderId) ?? null;
    if (!leader || leader.deadUntilMs !== null || leader.hp <= 0) {
      faction.targetPlayerId = null;
      continue;
    }

    const members = enemies.filter(
      (enemy) => enemy.factionId === faction.id && enemy.deadUntilMs === null && enemy.hp > 0
    );
    const previousMode = faction.formationMode;
    const previousTarget = faction.targetPlayerId;
    let targetPlayer: { characterId: number; x: number; y: number } | null = null;
    let forceShieldWall = false;
    const factionAggro = NPC_FACTION_AGGRO_BY_ID.get(faction.id) ?? null;
    if (factionAggro && factionAggro.untilMs > nowMs) {
      const aggPlayer = playersById.get(factionAggro.playerId) ?? null;
      if (aggPlayer && !aggPlayer.isSpawnProtected) {
        if (faction.behavior === "neutral") {
          const distToLeader = Math.hypot(aggPlayer.x - leader.x, aggPlayer.y - leader.y);
          if (distToLeader <= NPC_FACTION_IDLE_RADIUS) {
            targetPlayer = { characterId: factionAggro.playerId, x: aggPlayer.x, y: aggPlayer.y };
            forceShieldWall = true;
          }
        } else {
          targetPlayer = { characterId: factionAggro.playerId, x: aggPlayer.x, y: aggPlayer.y };
        }
      }
    }

    if (!targetPlayer) {
      if (faction.behavior === "aggressive") {
        let nearest: { characterId: number; x: number; y: number } | null = null;
        let nearestDist = Number.POSITIVE_INFINITY;
        for (const player of playersById.values()) {
          if (player.isSpawnProtected) {
            continue;
          }
          for (const member of members) {
            const dist = Math.hypot(player.x - member.x, player.y - member.y);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearest = { characterId: player.characterId, x: player.x, y: player.y };
            }
          }
        }
        if (nearest && nearestDist <= NPC_FACTION_DETECTION_RADIUS) {
          targetPlayer = nearest;
        }
      }
    }

    faction.targetPlayerId = targetPlayer?.characterId ?? null;

    if (!targetPlayer) {
      faction.formationMode = "cerco";
      continue;
    }

    const allowedRadius =
      faction.formationMode === "cerco" || faction.formationMode === "ataque"
        ? NPC_FACTION_ATTACK_LEASH_RADIUS
        : NPC_FACTION_COMMAND_RADIUS;
    const maxDistFromLeader = members.reduce((maxDist, member) => {
      const dist = Math.hypot(member.x - leader.x, member.y - leader.y);
      return Math.max(maxDist, dist);
    }, 0);
    if (maxDistFromLeader > allowedRadius) {
      if (nowMs - faction.lastCommandAtMs > 1200) {
        queueNpcChat(leader.id, "RECUAR!", randomInt(200, 350));
        applyNpcPause(leader, nowMs, 7);
      }
      faction.targetPlayerId = null;
      faction.formationMode = "cerco";
      faction.formationUntilMs = 0;
      faction.lastCommandAtMs = nowMs;
      faction.formationAnchorX = leader.x;
      faction.formationAnchorY = leader.y;
      faction.formationAnchorTargetX = leader.x;
      faction.formationAnchorTargetY = leader.y;
      faction.formationAnchorUpdatedAtMs = nowMs;
      faction.cercoAttackerId = null;
      faction.cercoLastSwitchAtMs = nowMs;
      continue;
    }

    if (nowMs < faction.formationUntilMs) {
      continue;
    }

    if (nowMs - faction.lastCommandAtMs < NPC_FORMATION_REEVAL_MS) {
      continue;
    }

    const recentHits = enemies.filter(
      (enemy) =>
        enemy.factionId === faction.id &&
        enemy.lastAttackedByPlayerId === targetPlayer?.characterId &&
        nowMs - enemy.lastAttackedAtMs <= NPC_FORMATION_SHIELD_WINDOW_MS
    );

    if (forceShieldWall || recentHits.length >= NPC_FORMATION_SHIELD_TRIGGER) {
      faction.formationMode = "shield_wall";
      faction.formationUntilMs = nowMs + NPC_FORMATION_SHIELD_DURATION_MS;
      faction.lastCommandAtMs = nowMs;
      if (previousMode !== faction.formationMode) {
        queueNpcChat(leader.id, "PAREDE DE ESCUDOS!", randomInt(200, 350));
        applyNpcPause(leader, nowMs, 18);
      }
      const anchor = computeFormationFrontCenter(leader, targetPlayer, faction.formationMode);
      faction.formationAnchorX = anchor.x;
      faction.formationAnchorY = anchor.y;
      faction.formationAnchorTargetX = targetPlayer.x;
      faction.formationAnchorTargetY = targetPlayer.y;
      faction.formationAnchorUpdatedAtMs = nowMs;
      continue;
    }
    if (recentHits.length > 0) {
      faction.formationMode = "ataque";
      faction.formationUntilMs = nowMs + NPC_FORMATION_CHASE_ON_HIT_MS;
      faction.lastCommandAtMs = nowMs;
      if (previousMode !== faction.formationMode) {
        queueNpcChat(leader.id, "ATAQUE!!", randomInt(200, 350));
        applyNpcPause(leader, nowMs, 8);
      }
      continue;
    }

    const distToPlayer = Math.hypot(targetPlayer.x - leader.x, targetPlayer.y - leader.y);
    if (distToPlayer >= NPC_FORMATION_CHASE_DISTANCE) {
      faction.formationMode = "ataque";
      faction.formationUntilMs = nowMs + NPC_FORMATION_REEVAL_MS * 2;
      faction.lastCommandAtMs = nowMs;
      if (previousMode !== faction.formationMode) {
        queueNpcChat(leader.id, "ATAQUE!!", randomInt(200, 350));
        applyNpcPause(leader, nowMs, 10);
      }
      continue;
    }

    faction.formationMode = "cerco";
    faction.formationUntilMs = 0;
    faction.lastCommandAtMs = nowMs;

    if (previousMode !== faction.formationMode || previousTarget !== faction.targetPlayerId) {
      if (previousMode !== faction.formationMode) {
        queueNpcChat(leader.id, "CERCO!!!", randomInt(200, 350));
        applyNpcPause(leader, nowMs, 10);
      }
      const anchor = computeFormationFrontCenter(leader, targetPlayer, faction.formationMode);
      faction.formationAnchorX = anchor.x;
      faction.formationAnchorY = anchor.y;
      faction.formationAnchorTargetX = targetPlayer.x;
      faction.formationAnchorTargetY = targetPlayer.y;
      faction.formationAnchorUpdatedAtMs = nowMs;
    }

    if (faction.formationMode === "cerco" && faction.targetPlayerId) {
      const knights = members.filter((member) => member.enemyType === "WARRIOR");
      const currentAttacker = faction.cercoAttackerId ? enemiesById.get(faction.cercoAttackerId) ?? null : null;
      const attackerValid =
        currentAttacker &&
        currentAttacker.deadUntilMs === null &&
        currentAttacker.hp > 0 &&
        currentAttacker.factionId === faction.id &&
        currentAttacker.enemyType === "WARRIOR";

      let shouldSwitch = !attackerValid;
      if (attackerValid) {
        if (nowMs - faction.cercoLastSwitchAtMs > NPC_CERCO_ATTACKER_SWAP_MS) {
          shouldSwitch = true;
        }
        if (
          currentAttacker.lastAttackAtMs > faction.cercoLastSwitchAtMs &&
          nowMs - currentAttacker.lastAttackAtMs > NPC_CERCO_ATTACKER_POST_ATTACK_MS
        ) {
          shouldSwitch = true;
        }
      }

      if (knights.length === 0) {
        faction.cercoAttackerId = null;
      } else if (shouldSwitch) {
        const sorted = [...knights]
          .filter((knight) => knight.id !== currentAttacker?.id)
          .sort((a, b) => {
            const distA = Math.hypot(a.x - targetPlayer.x, a.y - targetPlayer.y);
            const distB = Math.hypot(b.x - targetPlayer.x, b.y - targetPlayer.y);
            return distA - distB;
          });
        const nextAttacker = sorted[0] ?? currentAttacker ?? knights[0];
        faction.cercoAttackerId = nextAttacker.id;
        faction.cercoLastSwitchAtMs = nowMs;
      }
    } else {
      faction.cercoAttackerId = null;
    }
  }
}

function applyNpcPause(enemy: OnlineEnemyState, nowMs: number, textLength = 0): void {
  const lengthBoost = Math.min(1000, textLength * 18);
  const duration = NPC_CHAT_PAUSE_BASE_MS + lengthBoost + randomInt(0, NPC_CHAT_PAUSE_MAX_MS);
  enemy.pauseUntilMs = Math.max(enemy.pauseUntilMs, nowMs + duration);
  enemy.inputX = 0;
  enemy.inputY = 0;
  enemy.moving = false;
}

function queueNpcChat(enemyId: number, text: string, delayMs = 900): void {
  NPC_CHAT_QUEUE.push({
    enemyId,
    text: text.slice(0, 160),
    dueAtMs: Date.now() + Math.max(0, delayMs)
  });
}

function computeSeparationVector(enemy: OnlineEnemyState, others: OnlineEnemyState[]): { x: number; y: number } {
  let pushX = 0;
  let pushY = 0;
  for (const other of others) {
    if (other.id === enemy.id) {
      continue;
    }
    const dx = enemy.x - other.x;
    const dy = enemy.y - other.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.0001 || dist > NPC_SEPARATION_RADIUS) {
      continue;
    }
    const strength = (NPC_SEPARATION_RADIUS - dist) / NPC_SEPARATION_RADIUS;
    pushX += (dx / dist) * strength;
    pushY += (dy / dist) * strength;
  }
  return { x: pushX, y: pushY };
}

function healEnemyNpc(target: OnlineEnemyState, amount: number): number {
  const hpBefore = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + Math.max(0, amount));
  const healedAmount = target.hp - hpBefore;
  if (healedAmount > 0) {
    target.dirtyState = true;
  }
  return healedAmount;
}

function formationSlotOffset(index: number, count: number, spacing: number): number {
  if (count <= 1) {
    return 0;
  }
  const middle = (count - 1) / 2;
  return (index - middle) * spacing;
}

function findNearestValidPosition(
  x: number,
  y: number,
  maxRadius: number,
  tileSolido: (x: number, y: number) => boolean,
  occupied?: Set<string>
): { x: number; y: number } {
  const baseX = clamp(x, 1, MAP_SIZE - 2);
  const baseY = clamp(y, 1, MAP_SIZE - 2);
  const roundedX = Math.round(baseX);
  const roundedY = Math.round(baseY);
  const baseKey = `${roundedX},${roundedY}`;
  if (!tileSolido(roundedX, roundedY) && (!occupied || !occupied.has(baseKey))) {
    return { x: baseX, y: baseY };
  }

  const offsets: Array<{ dx: number; dy: number; dist: number }> = [];
  for (let dy = -maxRadius; dy <= maxRadius; dy += 1) {
    for (let dx = -maxRadius; dx <= maxRadius; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const dist = Math.hypot(dx, dy);
      if (dist <= maxRadius) {
        offsets.push({ dx, dy, dist });
      }
    }
  }
  offsets.sort((a, b) => a.dist - b.dist);

  for (const offset of offsets) {
    const candidateX = clamp(baseX + offset.dx, 1, MAP_SIZE - 2);
    const candidateY = clamp(baseY + offset.dy, 1, MAP_SIZE - 2);
    const tileKey = `${Math.round(candidateX)},${Math.round(candidateY)}`;
    if (!tileSolido(Math.round(candidateX), Math.round(candidateY)) && (!occupied || !occupied.has(tileKey))) {
      return { x: candidateX, y: candidateY };
    }
  }

  return { x: baseX, y: baseY };
}

function facingVector(direction: Direction): { x: number; y: number } {
  if (direction === "left") {
    return { x: -1, y: 0 };
  }
  if (direction === "right") {
    return { x: 1, y: 0 };
  }
  if (direction === "up") {
    return { x: 0, y: -1 };
  }
  return { x: 0, y: 1 };
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

    const warriorCount = Math.max(0, spawn.warriorCount ?? 0);
    const monkCount = Math.max(0, spawn.monkCount ?? 0);
    const mixedTotal = warriorCount + monkCount;

    if (mixedTotal > 0) {
      for (let i = 0; i < warriorCount; i += 1) {
        const enemy = createEnemyState({
          spawnId: spawn.id,
          name: generateRandomName(),
          x: spawn.x,
          y: spawn.y,
          enemyType: "WARRIOR",
          isAiCompanion: false,
          aiPersonaId: null
        });
        DATA_BY_SPAWN.get(spawn.id)?.push(enemy);
      }
      for (let i = 0; i < monkCount; i += 1) {
        const enemy = createEnemyState({
          spawnId: spawn.id,
          name: generateRandomName(),
          x: spawn.x,
          y: spawn.y,
          enemyType: "MONK",
          isAiCompanion: false,
          aiPersonaId: null
        });
        DATA_BY_SPAWN.get(spawn.id)?.push(enemy);
      }
    } else {
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
  }

  assignNpcFactions(getAllEnemies());

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

export function forceNpcFormation(mode: "shield_wall" | "cerco" | "ataque"): number {
  const nowMs = Date.now();
  const players = buildPublicPlayersSnapshot().filter((player) => player.hp > 0);
  if (players.length === 0) {
    return 0;
  }

  const enemiesById = new Map(getAllEnemies().map((enemy) => [enemy.id, enemy]));
  let updated = 0;

  for (const faction of NPC_FACTIONS.values()) {
    const leader = enemiesById.get(faction.leaderId) ?? null;
    if (!leader || leader.deadUntilMs !== null || leader.hp <= 0) {
      continue;
    }

    let nearest = players[0];
    let nearestDist = Math.hypot(nearest.x - leader.x, nearest.y - leader.y);
    for (const player of players.slice(1)) {
      const dist = Math.hypot(player.x - leader.x, player.y - leader.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = player;
      }
    }

    faction.targetPlayerId = nearest.id;
    faction.formationMode = mode;
    faction.formationUntilMs =
      mode === "shield_wall" ? nowMs + NPC_FORMATION_SHIELD_DURATION_MS : nowMs + NPC_FORMATION_REEVAL_MS * 2;
    faction.lastCommandAtMs = nowMs;
    const anchor = computeFormationFrontCenter(leader, nearest, mode);
    faction.formationAnchorX = anchor.x;
    faction.formationAnchorY = anchor.y;
    faction.formationAnchorTargetX = nearest.x;
    faction.formationAnchorTargetY = nearest.y;
    faction.formationAnchorUpdatedAtMs = nowMs;
    updated += 1;
  }

  return updated;
}

export function tickAiCompanionDirector(nowMs = Date.now()): void {
  enemyAiDirector.tickAiCompanionDirector(nowMs);
}

const NPC_CHAT_LINES = [
  "O vento mudou. Fique atento.",
  "A noite nao esta tao calma quanto parece.",
  "Ouvi passos no norte.",
  "Nossa patrulha nao deve falhar.",
  "Fique perto do lider.",
  "Os viajantes andam nervosos hoje."
];

const NPC_CHAT_REPLIES = [
  "Estou de olho.",
  "Entendido.",
  "Certo, vou manter a guarda.",
  "Avise se algo se mover.",
  "Seguirei o sinal.",
  "Concordo."
];

export function tickNpcChatter(nowMs = Date.now()): void {
  if (nowMs < nextNpcChatAtMs) {
    return;
  }

  const candidates = getAllEnemies().filter(
    (enemy) =>
      !enemy.isAiCompanion &&
      enemy.deadUntilMs === null &&
      enemy.hp > 0 &&
      enemy.targetPlayerId === null &&
      nowMs >= enemy.pauseUntilMs &&
      nowMs - enemy.lastSocialChatAtMs > NPC_CHAT_INTERVAL_MIN_MS * 0.6
  );

  if (candidates.length < 2) {
    nextNpcChatAtMs = nowMs + randomInt(4000, 7000);
    return;
  }

  const shuffled = [...candidates];
  shuffleInPlace(shuffled);

  let spoke = false;
  for (const speaker of shuffled) {
    const listener = candidates.find(
      (other) =>
        other.id !== speaker.id &&
        Math.hypot(other.x - speaker.x, other.y - speaker.y) <= NPC_CHAT_RADIUS &&
        nowMs - other.lastSocialChatAtMs > NPC_CHAT_INTERVAL_MIN_MS * 0.6
    );
    if (!listener) {
      continue;
    }

    const line = randomFrom(NPC_CHAT_LINES);
    const reply = randomFrom(NPC_CHAT_REPLIES);
    queueNpcChat(speaker.id, line, randomInt(300, 700));
    queueNpcChat(listener.id, reply, randomInt(1200, 2000));
    applyNpcPause(speaker, nowMs, line.length);
    applyNpcPause(listener, nowMs + 350, reply.length);
    speaker.lastSocialChatAtMs = nowMs;
    listener.lastSocialChatAtMs = nowMs;
    spoke = true;
    break;
  }

  nextNpcChatAtMs = nowMs + randomInt(NPC_CHAT_INTERVAL_MIN_MS, NPC_CHAT_INTERVAL_MAX_MS);
  if (!spoke) {
    nextNpcChatAtMs = nowMs + randomInt(4000, 8000);
  }
}

export function consumePendingAiChatMessages(
  nowMs = Date.now()
): Array<{ enemyId: number; enemyName: string; text: string }> {
  return enemyAiDirector.consumePendingAiChatMessages(nowMs);
}

export function consumePendingNpcChatMessages(
  nowMs = Date.now()
): Array<{ enemyId: number; enemyName: string; text: string }> {
  if (NPC_CHAT_QUEUE.length === 0) {
    return [];
  }

  NPC_CHAT_QUEUE.sort((a, b) => a.dueAtMs - b.dueAtMs);
  const ready: Array<{ enemyId: number; enemyName: string; text: string }> = [];

  while (NPC_CHAT_QUEUE.length > 0 && NPC_CHAT_QUEUE[0].dueAtMs <= nowMs) {
    const nextMessage = NPC_CHAT_QUEUE.shift();
    if (!nextMessage) {
      break;
    }
    const enemy = getEnemyById(nextMessage.enemyId);
    if (!enemy) {
      continue;
    }
    if (enemy.deadUntilMs !== null && enemy.deadUntilMs > nowMs) {
      continue;
    }
    ready.push({
      enemyId: enemy.id,
      enemyName: enemy.name,
      text: nextMessage.text
    });
  }

  return ready;
}

export function updateEnemyTargets(
  playerPositions: Array<{ characterId: number; x: number; y: number; isSpawnProtected: boolean }>,
  attackedByPlayerId: (enemyId: number) => number | null
): void {
  const playersById = new Map(playerPositions.map((player) => [player.characterId, player]));
  const now = Date.now();
  const allEnemies = getAllEnemies();
  const enemiesById = new Map(allEnemies.map((enemy) => [enemy.id, enemy]));
  refreshFactionLeaders(now, enemiesById);
  refreshFactionAggro(now, allEnemies, playersById);
  refreshFactionFormations(now, allEnemies, playersById);

  for (const enemies of DATA_BY_SPAWN.values()) {
    for (const enemy of enemies) {
      if (enemy.deadUntilMs !== null && enemy.deadUntilMs > now) {
        continue;
      }

      const lastAttackerId = attackedByPlayerId(enemy.id);

      if (enemy.isAiCompanion) {
        enemyAiDirector.updateCompanionTargeting(enemy, playerPositions, lastAttackerId, now);
        continue;
      }

      const faction = getFactionForEnemy(enemy);
      const factionAggro = faction ? NPC_FACTION_AGGRO_BY_ID.get(faction.id) ?? null : null;
      const directAggroActive =
        enemy.lastAttackedByPlayerId !== null && now - enemy.lastAttackedAtMs <= NPC_FACTION_AGGRO_MEMORY_MS;
      const directAggroId = directAggroActive ? enemy.lastAttackedByPlayerId : null;

      if (enemy.enemyType === "MONK") {
        enemy.targetPlayerId = null;
      } else {
        if (directAggroId !== null) {
          const attackerState = playersById.get(directAggroId);
          if (attackerState && !attackerState.isSpawnProtected) {
            enemy.targetPlayerId = directAggroId;
            enemy.lastTargetChangeAtMs = now;
          }
        } else if (lastAttackerId !== null) {
          const lastAttacker = playersById.get(lastAttackerId);
          if (lastAttacker && !lastAttacker.isSpawnProtected) {
            enemy.targetPlayerId = lastAttackerId;
            enemy.lastTargetChangeAtMs = now;
          }
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

      if (enemy.targetPlayerId === null && enemy.enemyType !== "MONK") {
        const factionAggroTarget =
          factionAggro && factionAggro.untilMs > now ? playersById.get(factionAggro.playerId) ?? null : null;
        if (factionAggroTarget && !factionAggroTarget.isSpawnProtected) {
          const dist = Math.hypot(factionAggroTarget.x - enemy.x, factionAggroTarget.y - enemy.y);
          if (dist <= ENEMY_CHASE_RADIUS) {
            enemy.targetPlayerId = factionAggroTarget.characterId;
          }
        }

        const aggroOnSight = faction?.behavior === "aggressive" || faction === null;
        if (enemy.targetPlayerId === null && aggroOnSight) {
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

      if (faction?.targetPlayerId && enemy.enemyType !== "MONK") {
        const target = playersById.get(faction.targetPlayerId);
        if (target && !target.isSpawnProtected) {
          enemy.targetPlayerId = faction.targetPlayerId;
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
  const nowMs = Date.now();
  const allEnemies = getAllEnemies();
  const enemiesById = new Map(allEnemies.map((enemy) => [enemy.id, enemy]));
  const nonAiAlive = allEnemies.filter(
    (enemy) => !enemy.isAiCompanion && enemy.deadUntilMs === null && enemy.hp > 0
  );
  const playersById = new Map(playerPositions.map((player) => [player.characterId, player]));

  const factionSlotsByEnemyId = new Map<number, { x: number; y: number }>();
  const factionPlanById = new Map<
    number,
    {
      leaderId: number;
      targetPlayerId: number;
      mode: NpcFormationMode;
    }
  >();

  for (const faction of NPC_FACTIONS.values()) {
    const leader = enemiesById.get(faction.leaderId);
    if (!leader || leader.deadUntilMs !== null || leader.hp <= 0) {
      continue;
    }
    if (!faction.targetPlayerId) {
      continue;
    }
    const target = playersById.get(faction.targetPlayerId);
    if (!target) {
      continue;
    }

    const members = nonAiAlive.filter((enemy) => enemy.factionId === faction.id);
    if (members.length === 0) {
      continue;
    }

    const knights = members
      .filter((enemy) => enemy.enemyType === "WARRIOR")
      .sort((a, b) => a.id - b.id);
    const monks = members
      .filter((enemy) => enemy.enemyType === "MONK")
      .sort((a, b) => a.id - b.id);
    const backDir = normalizeVector(leader.x - target.x, leader.y - target.y);
    const forwardDir = normalizeVector(target.x - leader.x, target.y - leader.y);
    const perp = { x: -backDir.y, y: backDir.x };
    const occupiedSlots = new Set<string>();

    if (faction.formationMode === "cerco") {
      const attackerId = faction.cercoAttackerId ?? null;
      const ringKnights = attackerId ? knights.filter((enemy) => enemy.id !== attackerId) : knights;
      if (ringKnights.length > 0) {
        const radius = Math.max(
          NPC_ENCIRCLE_MIN_DISTANCE,
          NPC_ENCIRCLE_RADIUS_BASE + ringKnights.length * NPC_ENCIRCLE_RADIUS_PER_MEMBER
        );
        ringKnights.forEach((enemy, index) => {
          const angle = (index / ringKnights.length) * Math.PI * 2 + enemy.encircleAngleRad * 0.2;
          const slot = findNearestValidPosition(
            target.x + Math.cos(angle) * radius,
            target.y + Math.sin(angle) * radius,
            NPC_FORMATION_SLOT_SEARCH_RADIUS,
            tileSolido,
            occupiedSlots
          );
          occupiedSlots.add(`${Math.round(slot.x)},${Math.round(slot.y)}`);
          factionSlotsByEnemyId.set(enemy.id, slot);
        });
      }

      const monksCenter = findNearestValidPosition(
        leader.x + backDir.x * (NPC_FORMATION_MONK_BACK_OFFSET + 0.6),
        leader.y + backDir.y * (NPC_FORMATION_MONK_BACK_OFFSET + 0.6),
        NPC_FORMATION_SLOT_SEARCH_RADIUS,
        tileSolido,
        occupiedSlots
      );
      occupiedSlots.add(`${Math.round(monksCenter.x)},${Math.round(monksCenter.y)}`);
      monks.forEach((enemy, index) => {
        const offset = formationSlotOffset(index, monks.length, NPC_FORMATION_LINE_SPACING);
        const slot = findNearestValidPosition(
          monksCenter.x + perp.x * offset,
          monksCenter.y + perp.y * offset,
          NPC_FORMATION_SLOT_SEARCH_RADIUS,
          tileSolido,
          occupiedSlots
        );
        occupiedSlots.add(`${Math.round(slot.x)},${Math.round(slot.y)}`);
        factionSlotsByEnemyId.set(enemy.id, slot);
      });
    } else if (faction.formationMode === "shield_wall") {
      const desiredFrontCenter = computeFormationFrontCenter(leader, target, faction.formationMode);
      const anchorAge = nowMs - faction.formationAnchorUpdatedAtMs;
      const targetMoved = Math.hypot(
        target.x - faction.formationAnchorTargetX,
        target.y - faction.formationAnchorTargetY
      );
      if (!Number.isFinite(faction.formationAnchorX) || !Number.isFinite(faction.formationAnchorY)) {
        faction.formationAnchorX = desiredFrontCenter.x;
        faction.formationAnchorY = desiredFrontCenter.y;
        faction.formationAnchorTargetX = target.x;
        faction.formationAnchorTargetY = target.y;
        faction.formationAnchorUpdatedAtMs = nowMs;
      } else if (anchorAge >= NPC_FORMATION_ANCHOR_UPDATE_MS || targetMoved >= NPC_FORMATION_ANCHOR_MOVE_THRESHOLD) {
        const lerpFactor =
          faction.formationMode === "shield_wall" ? NPC_FORMATION_SHIELD_LERP : NPC_FORMATION_ANCHOR_LERP;
        faction.formationAnchorX = lerp(faction.formationAnchorX, desiredFrontCenter.x, lerpFactor);
        faction.formationAnchorY = lerp(faction.formationAnchorY, desiredFrontCenter.y, lerpFactor);
        faction.formationAnchorTargetX = target.x;
        faction.formationAnchorTargetY = target.y;
        faction.formationAnchorUpdatedAtMs = nowMs;
      }

      const frontCenter = {
        x: faction.formationAnchorX,
        y: faction.formationAnchorY
      };

      knights.forEach((enemy, index) => {
        const offset = formationSlotOffset(index, knights.length, NPC_FORMATION_LINE_SPACING);
        const slot = findNearestValidPosition(
          frontCenter.x + perp.x * offset,
          frontCenter.y + perp.y * offset,
          NPC_FORMATION_SLOT_SEARCH_RADIUS,
          tileSolido,
          occupiedSlots
        );
        occupiedSlots.add(`${Math.round(slot.x)},${Math.round(slot.y)}`);
        factionSlotsByEnemyId.set(enemy.id, slot);
      });

      const monksCenter = findNearestValidPosition(
        frontCenter.x + backDir.x * NPC_FORMATION_MONK_BACK_OFFSET,
        frontCenter.y + backDir.y * NPC_FORMATION_MONK_BACK_OFFSET,
        NPC_FORMATION_SLOT_SEARCH_RADIUS,
        tileSolido,
        occupiedSlots
      );
      occupiedSlots.add(`${Math.round(monksCenter.x)},${Math.round(monksCenter.y)}`);
      monks.forEach((enemy, index) => {
        const offset = formationSlotOffset(index, monks.length, NPC_FORMATION_LINE_SPACING);
        const slot = findNearestValidPosition(
          monksCenter.x + perp.x * offset,
          monksCenter.y + perp.y * offset,
          NPC_FORMATION_SLOT_SEARCH_RADIUS,
          tileSolido,
          occupiedSlots
        );
        occupiedSlots.add(`${Math.round(slot.x)},${Math.round(slot.y)}`);
        factionSlotsByEnemyId.set(enemy.id, slot);
      });

      const leaderPos = findNearestValidPosition(
        monksCenter.x + backDir.x * NPC_FORMATION_LEADER_BACK_OFFSET,
        monksCenter.y + backDir.y * NPC_FORMATION_LEADER_BACK_OFFSET,
        NPC_FORMATION_SLOT_SEARCH_RADIUS,
        tileSolido,
        occupiedSlots
      );
      occupiedSlots.add(`${Math.round(leaderPos.x)},${Math.round(leaderPos.y)}`);
      factionSlotsByEnemyId.set(leader.id, leaderPos);
    }

    factionPlanById.set(faction.id, {
      leaderId: leader.id,
      targetPlayerId: faction.targetPlayerId,
      mode: faction.formationMode
    });
  }

  const encircleSlotsByEnemyId = new Map<number, { angle: number; radius: number }>();
  const enemiesByTarget = new Map<number, OnlineEnemyState[]>();
  for (const enemy of nonAiAlive) {
    if (enemy.enemyType === "MONK" || enemy.targetPlayerId === null) {
      continue;
    }
    const group = enemiesByTarget.get(enemy.targetPlayerId) ?? [];
    group.push(enemy);
    enemiesByTarget.set(enemy.targetPlayerId, group);
  }
  for (const group of enemiesByTarget.values()) {
    group.sort((a, b) => a.id - b.id);
    const count = group.length;
    const radius = Math.max(
      NPC_ENCIRCLE_MIN_DISTANCE,
      NPC_ENCIRCLE_RADIUS_BASE + count * NPC_ENCIRCLE_RADIUS_PER_MEMBER
    );
    for (let index = 0; index < group.length; index += 1) {
      const enemy = group[index];
      const angle = (index / count) * Math.PI * 2 + enemy.encircleAngleRad * 0.15;
      encircleSlotsByEnemyId.set(enemy.id, { angle, radius });
    }
  }

  for (const enemies of DATA_BY_SPAWN.values()) {
    for (const enemy of enemies) {
      if ((enemy.deadUntilMs !== null && enemy.deadUntilMs > nowMs) || enemy.isAttacking) {
        enemy.inputX = 0;
        enemy.inputY = 0;
        continue;
      }

      if (nowMs < enemy.pauseUntilMs) {
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

      if (enemy.isAiCompanion) {
        const nearestPlayerDistance = playerPositions.reduce((minDist, player) => {
          const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
          return Math.min(minDist, dist);
        }, Number.POSITIVE_INFINITY);
        const shouldHoldForConversation =
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
        } else if (enemy.followPlayerId !== null) {
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
        } else if (enemy.allyEnemyId !== null) {
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

        if (targetX === 0 && targetY === 0) {
          if (shouldHoldForConversation) {
            enemy.idleUntilMs = Math.max(enemy.idleUntilMs, nowMs + randomInt(900, 1700));
            enemy.wanderUntilMs = enemy.idleUntilMs;
          } else {
            const distFromSpawn = Math.hypot(enemy.x - enemy.spawnX, enemy.y - enemy.spawnY);
            if (distFromSpawn > ENEMY_SPAWN_RADIUS + 2) {
              const backToOrigin = normalizeVector(enemy.spawnX - enemy.x, enemy.spawnY - enemy.y);
              targetX = backToOrigin.x;
              targetY = backToOrigin.y;
            } else if (nowMs < enemy.idleUntilMs) {
              targetX = 0;
              targetY = 0;
            } else if (nowMs >= enemy.wanderUntilMs) {
              const shouldIdleNow = Math.random() < AI_WANDER_IDLE_CHANCE;
              if (shouldIdleNow) {
                enemy.idleUntilMs = nowMs + randomInt(AI_IDLE_MIN_MS, AI_IDLE_MAX_MS);
                enemy.wanderUntilMs = enemy.idleUntilMs;
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
      } else {
        const faction = getFactionForEnemy(enemy);
        const factionPlan = faction ? factionPlanById.get(faction.id) ?? null : null;

        if (factionPlan && factionPlan.targetPlayerId) {
          const targetPlayer = playersById.get(factionPlan.targetPlayerId) ?? null;
          if (!targetPlayer) {
            // sem alvo valido
          } else if (factionPlan.mode === "ataque") {
            if (enemy.id === factionPlan.leaderId) {
              const dx = targetPlayer.x - enemy.x;
              const dy = targetPlayer.y - enemy.y;
              const dist = Math.hypot(dx, dy);
              const desired = NPC_LEADER_CHASE_DISTANCE;
              if (dist > desired + NPC_LEADER_CHASE_BAND) {
                const normalized = normalizeVector(dx, dy);
                targetX = normalized.x;
                targetY = normalized.y;
              } else if (dist < desired - NPC_LEADER_CHASE_BAND) {
                const away = normalizeVector(enemy.x - targetPlayer.x, enemy.y - targetPlayer.y);
                targetX = away.x;
                targetY = away.y;
              } else {
                targetX = 0;
                targetY = 0;
              }
            } else {
              const leader = enemiesById.get(factionPlan.leaderId) ?? null;
              if (leader) {
                const dx = leader.x - enemy.x;
                const dy = leader.y - enemy.y;
                const dist = Math.hypot(dx, dy);
                if (dist > NPC_FACTION_ATTACK_LEASH_RADIUS) {
                  const normalized = normalizeVector(dx, dy);
                  targetX = normalized.x;
                  targetY = normalized.y;
                }
              }

              if (targetX === 0 && targetY === 0) {
                if (enemy.enemyType === "MONK" && leader) {
                  const dx = leader.x - enemy.x;
                  const dy = leader.y - enemy.y;
                  const dist = Math.hypot(dx, dy);
                  if (dist > NPC_FACTION_GUARD_RADIUS * 2.2) {
                    const normalized = normalizeVector(dx, dy);
                    targetX = normalized.x;
                    targetY = normalized.y;
                  }
                } else {
                  const toTarget = normalizeVector(targetPlayer.x - enemy.x, targetPlayer.y - enemy.y);
                  const side = { x: -toTarget.y, y: toTarget.x };
                  const lateral = Math.sin(enemy.encircleAngleRad) * 0.6;
                  const combined = normalizeVector(
                    toTarget.x + side.x * lateral,
                    toTarget.y + side.y * lateral
                  );
                  targetX = combined.x;
                  targetY = combined.y;
                }
              }
            }
          } else if (factionPlan.mode === "cerco") {
            const leader = enemiesById.get(factionPlan.leaderId) ?? null;
            const attackerId = faction?.cercoAttackerId ?? null;
            if (enemy.id === factionPlan.leaderId) {
              const dx = targetPlayer.x - enemy.x;
              const dy = targetPlayer.y - enemy.y;
              const dist = Math.hypot(dx, dy);
              const desired = NPC_LEADER_CHASE_DISTANCE;
              if (dist > desired + NPC_LEADER_CHASE_BAND) {
                const normalized = normalizeVector(dx, dy);
                targetX = normalized.x;
                targetY = normalized.y;
              } else if (dist < desired - NPC_LEADER_CHASE_BAND) {
                const away = normalizeVector(enemy.x - targetPlayer.x, enemy.y - targetPlayer.y);
                targetX = away.x;
                targetY = away.y;
              } else {
                targetX = 0;
                targetY = 0;
              }
            } else {
              if (leader) {
                const dxLeader = leader.x - enemy.x;
                const dyLeader = leader.y - enemy.y;
                const distLeader = Math.hypot(dxLeader, dyLeader);
                if (distLeader > NPC_FACTION_ATTACK_LEASH_RADIUS) {
                  const normalized = normalizeVector(dxLeader, dyLeader);
                  targetX = normalized.x;
                  targetY = normalized.y;
                }
              }

              if (targetX === 0 && targetY === 0 && attackerId && enemy.id === attackerId) {
                const dx = targetPlayer.x - enemy.x;
                const dy = targetPlayer.y - enemy.y;
                const dist = Math.hypot(dx, dy);
                if (dist > ENEMY_ATTACK_DISTANCE) {
                  const normalized = normalizeVector(dx, dy);
                  targetX = normalized.x;
                  targetY = normalized.y;
                } else {
                  targetX = 0;
                  targetY = 0;
                }
              }

              if (targetX === 0 && targetY === 0) {
                const desired = factionSlotsByEnemyId.get(enemy.id) ?? null;
                if (desired) {
                  const dx = desired.x - enemy.x;
                  const dy = desired.y - enemy.y;
                  const dist = Math.hypot(dx, dy);
                  if (dist > NPC_FORMATION_SLOT_HOLD_RADIUS) {
                    const normalized = normalizeVector(dx, dy);
                    const speedScale =
                      dist < NPC_FORMATION_SLOT_SLOW_RADIUS ? dist / NPC_FORMATION_SLOT_SLOW_RADIUS : 1;
                    targetX = normalized.x * speedScale;
                    targetY = normalized.y * speedScale;
                  } else {
                    targetX = 0;
                    targetY = 0;
                  }
                }
              }
            }
          } else {
            const leader = enemiesById.get(factionPlan.leaderId) ?? null;
            if (leader && enemy.id !== factionPlan.leaderId) {
              const dxLeader = leader.x - enemy.x;
              const dyLeader = leader.y - enemy.y;
              const distLeader = Math.hypot(dxLeader, dyLeader);
              if (distLeader > NPC_FACTION_COMMAND_RADIUS) {
                const normalized = normalizeVector(dxLeader, dyLeader);
                targetX = normalized.x;
                targetY = normalized.y;
              }
            }

            if (targetX === 0 && targetY === 0) {
              const desired = factionSlotsByEnemyId.get(enemy.id) ?? null;
              if (desired) {
                const dx = desired.x - enemy.x;
                const dy = desired.y - enemy.y;
                const dist = Math.hypot(dx, dy);
                if (dist > NPC_FORMATION_SLOT_HOLD_RADIUS) {
                  const normalized = normalizeVector(dx, dy);
                  const speedScale =
                    dist < NPC_FORMATION_SLOT_SLOW_RADIUS ? dist / NPC_FORMATION_SLOT_SLOW_RADIUS : 1;
                  targetX = normalized.x * speedScale;
                  targetY = normalized.y * speedScale;
                } else {
                  targetX = 0;
                  targetY = 0;
                }
              }
            }
          }
        } else {
          if (enemy.enemyType === "MONK") {
            let nearestPlayer: { characterId: number; x: number; y: number } | null = null;
            let nearestPlayerDist = Number.POSITIVE_INFINITY;
            for (const player of playerPositions) {
              const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
              if (dist < nearestPlayerDist) {
                nearestPlayerDist = dist;
                nearestPlayer = player;
              }
            }

            let nearestKnight: OnlineEnemyState | null = null;
            let nearestKnightDist = Number.POSITIVE_INFINITY;
            for (const ally of nonAiAlive) {
              if (ally.enemyType !== "WARRIOR") {
                continue;
              }
              if (faction && ally.factionId !== faction.id) {
                continue;
              }
              const dist = Math.hypot(ally.x - enemy.x, ally.y - enemy.y);
              if (dist < nearestKnightDist && dist <= NPC_MONK_SEEK_KNIGHT_RADIUS) {
                nearestKnightDist = dist;
                nearestKnight = ally;
              }
            }

            if (nearestPlayer && nearestPlayerDist <= NPC_MONK_AVOID_PLAYER_RADIUS) {
              const flee = normalizeVector(enemy.x - nearestPlayer.x, enemy.y - nearestPlayer.y);
              const fleeWeight = nearestPlayerDist <= NPC_MONK_FLEE_PLAYER_RADIUS ? 1 : 0.6;
              targetX += flee.x * fleeWeight;
              targetY += flee.y * fleeWeight;
              if (nearestKnight) {
                const toKnight = normalizeVector(nearestKnight.x - enemy.x, nearestKnight.y - enemy.y);
                targetX += toKnight.x * 0.6;
                targetY += toKnight.y * 0.6;
              }
            } else if (nearestKnight && nearestKnightDist > NPC_FACTION_GUARD_RADIUS) {
              const toKnight = normalizeVector(nearestKnight.x - enemy.x, nearestKnight.y - enemy.y);
              targetX += toKnight.x;
              targetY += toKnight.y;
            }
          } else if (enemy.targetPlayerId !== null) {
            const targetPlayer = playerPositions.find((p) => p.characterId === enemy.targetPlayerId);
            if (targetPlayer) {
              const slot = encircleSlotsByEnemyId.get(enemy.id);
              const radius = slot?.radius ?? NPC_ENCIRCLE_RADIUS_BASE;
              const angle = slot?.angle ?? enemy.encircleAngleRad;
              const desiredX = targetPlayer.x + Math.cos(angle) * radius;
              const desiredY = targetPlayer.y + Math.sin(angle) * radius;
              const dx = desiredX - enemy.x;
              const dy = desiredY - enemy.y;
              const dist = Math.hypot(dx, dy);
              if (dist > NPC_ENCIRCLE_MIN_DISTANCE) {
                const normalized = normalizeVector(dx, dy);
                targetX = normalized.x;
                targetY = normalized.y;
              }
            }
          }

          if (targetX === 0 && targetY === 0) {
            const leader = faction ? enemiesById.get(faction.leaderId) ?? null : null;
            if (leader && leader.id !== enemy.id && leader.deadUntilMs === null && leader.hp > 0) {
              const dx = leader.x - enemy.x;
              const dy = leader.y - enemy.y;
              const dist = Math.hypot(dx, dy);
              if (dist > NPC_FACTION_IDLE_RADIUS) {
                const normalized = normalizeVector(dx, dy);
                targetX = normalized.x;
                targetY = normalized.y;
              } else if (dist < NPC_FACTION_GUARD_RADIUS) {
                const normalized = normalizeVector(enemy.x - leader.x, enemy.y - leader.y);
                targetX = normalized.x;
                targetY = normalized.y;
              } else if (nowMs >= enemy.wanderUntilMs) {
                enemy.wanderUntilMs = nowMs + randomInt(AI_WANDER_MIN_MS, AI_WANDER_MAX_MS);
                const angle = enemy.encircleAngleRad + Math.random() * 0.6;
                targetX = Math.cos(angle);
                targetY = Math.sin(angle);
                enemy.inputX = targetX;
                enemy.inputY = targetY;
              } else {
                targetX = enemy.inputX;
                targetY = enemy.inputY;
              }
            }
          }
        }

        const leader = faction ? enemiesById.get(faction.leaderId) ?? null : null;
        if (leader && leader.id !== enemy.id) {
          const dx = leader.x - enemy.x;
          const dy = leader.y - enemy.y;
          const dist = Math.hypot(dx, dy);
          if (dist > NPC_FACTION_IDLE_RADIUS) {
            const normalized = normalizeVector(dx, dy);
            targetX = normalized.x;
            targetY = normalized.y;
          }
        }

        if (targetX === 0 && targetY === 0 && !enemy.isAiCompanion && !factionPlan) {
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
      }

      if (!enemy.isAiCompanion) {
        const separation = computeSeparationVector(enemy, nonAiAlive);
        const faction = getFactionForEnemy(enemy);
        const factionPlan = faction ? factionPlanById.get(faction.id) ?? null : null;
        const separationScale = factionPlan ? 0.35 : 1;
        if (Math.abs(separation.x) > 0.001 || Math.abs(separation.y) > 0.001) {
          targetX += separation.x * NPC_SEPARATION_STRENGTH * separationScale;
          targetY += separation.y * NPC_SEPARATION_STRENGTH * separationScale;
        }
      }

      enemy.inputX = clamp(targetX, -1, 1);
      enemy.inputY = clamp(targetY, -1, 1);

      const prevX = enemy.x;
      const prevY = enemy.y;
      let moveSpeed = enemy.isAiCompanion ? 1.8 : defaultMoveSpeed;
      if (!enemy.isAiCompanion) {
        const faction = getFactionForEnemy(enemy);
        if (faction && faction.leaderId === enemy.id) {
          moveSpeed *= NPC_LEADER_SPEED_MULT;
        }
      }

      const newX = enemy.x + enemy.inputX * moveSpeed * deltaSeconds;
      const newY = enemy.y + enemy.inputY * moveSpeed * deltaSeconds;

      if (!tileSolido(Math.round(newX), Math.round(newY))) {
        enemy.x = limitarAoMapa(newX);
        enemy.y = limitarAoMapa(newY);
      }

      if (Math.abs(enemy.inputX) <= 0.001 && Math.abs(enemy.inputY) <= 0.001) {
        const faction = getFactionForEnemy(enemy);
        const factionPlan = faction ? factionPlanById.get(faction.id) ?? null : null;
        if (factionPlan && factionPlan.targetPlayerId) {
          const targetPlayer = playersById.get(factionPlan.targetPlayerId) ?? null;
          if (targetPlayer) {
            const toPlayer = normalizeVector(targetPlayer.x - enemy.x, targetPlayer.y - enemy.y);
            enemy.facing = directionFromInput(toPlayer.x, toPlayer.y, enemy.facing);
          } else {
            enemy.facing = directionFromInput(enemy.inputX, enemy.inputY, enemy.facing);
          }
        } else {
          enemy.facing = directionFromInput(enemy.inputX, enemy.inputY, enemy.facing);
        }
      } else {
        enemy.facing = directionFromInput(enemy.inputX, enemy.inputY, enemy.facing);
      }

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
  const allEnemies = getAllEnemies();

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

      if (!enemy.isAiCompanion && enemy.enemyType === "MONK") {
        const faction = getFactionForEnemy(enemy);
        let bestAlly: OnlineEnemyState | null = null;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const ally of allEnemies) {
          if (ally.id === enemy.id) {
            continue;
          }
          if (ally.isAiCompanion || ally.deadUntilMs !== null || ally.hp <= 0) {
            continue;
          }
          if (faction && ally.factionId !== faction.id) {
            continue;
          }
          if (ally.hp >= ally.maxHp) {
            continue;
          }
          const dist = Math.hypot(ally.x - enemy.x, ally.y - enemy.y);
          if (dist < bestDist) {
            bestDist = dist;
            bestAlly = ally;
          }
        }

        const cooldownMs = nowMs - enemy.lastAttackAtMs;
        if (bestAlly && bestDist <= NPC_MONK_SUPPORT_RADIUS && cooldownMs >= NPC_MONK_SUPPORT_COOLDOWN_MS) {
          if (bestDist <= NPC_MONK_HEAL_RANGE) {
            const toTarget = normalizeVector(bestAlly.x - enemy.x, bestAlly.y - enemy.y);
            const facing = facingVector(enemy.facing);
            const facingDot = toTarget.x * facing.x + toTarget.y * facing.y;
            if (facingDot >= NPC_MONK_HEAL_FACING_DOT) {
              enemy.isAttacking = true;
              enemy.attackStartedAtMs = nowMs;
              const healedAmount = healEnemyNpc(bestAlly, NPC_MONK_SUPPORT_HEAL_AMOUNT);
              if (healedAmount > 0) {
                hits.push({
                  enemyId: enemy.id,
                  enemyName: enemy.name,
                  targetId: bestAlly.id,
                  targetName: bestAlly.name,
                  amount: healedAmount,
                  targetHp: bestAlly.hp,
                  targetDied: false,
                  effect: "heal"
                });
                enemy.dirtyState = true;
              }
            }
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
      enemy.lastAttackedByPlayerId = null;
      enemy.lastAttackedAtMs = 0;
      enemy.lastSocialChatAtMs = 0;
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
    enemy.lastAttackedByPlayerId = attacker.characterId;
    enemy.lastAttackedAtMs = Date.now();

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
        isAiCompanion: enemy.isAiCompanion,
        isFactionLeader:
          !enemy.isAiCompanion &&
          enemy.factionId !== null &&
          (NPC_FACTIONS.get(enemy.factionId)?.leaderId ?? null) === enemy.id
      });
    }
  }

  return enemies.sort((a, b) => a.id - b.id);
}
