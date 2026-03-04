import { MAP_SIZE, limitarAoMapa } from "../game.js";
import { env } from "../env.js";
import { logError, logInfo, logWarn } from "../logger.js";
import { buildPublicPlayersSnapshot, damagePlayer, healPlayer } from "./world.js";
import type { Direction } from "./types.js";

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

const AI_CHAT_RADIUS = 5;
const AI_FOLLOW_DISTANCE = 1.35;
const AI_HOSTILITY_THRESHOLD = 70;
const AI_FRIENDLY_THRESHOLD = 35;
const AI_HOSTILE_CHASE_RADIUS = 8;
const AI_INTERACT_COOLDOWN_MS = 2500;
const AI_RESPONSE_PAUSE_BASE_MS = 1400;
const AI_RESPONSE_PAUSE_MAX_MS = 3600;
const AI_CHAT_HOLD_RADIUS = 6;
const AI_IDLE_MIN_MS = 900;
const AI_IDLE_MAX_MS = 2800;
const AI_WANDER_MIN_MS = 900;
const AI_WANDER_MAX_MS = 2600;
const AI_WANDER_IDLE_CHANCE = 0.88;
const AI_FAKE_ATTACK_CHANCE_PER_TICK = 0.004;
const AI_FAKE_ATTACK_COOLDOWN_MS = 3200;
const FALLEN_KNIGHT_FOLLOW_MIN_TRUST = 58;
const FALLEN_KNIGHT_FOLLOW_MIN_CHATS = 2;
const FALLEN_KNIGHT_FOLLOW_MIN_KILLS = 3;
const AI_INTER_COMMS_INTERVAL_MS = 45000;
const AI_MEMORY_LIMIT = 12;
const AI_CHAT_MAX_CHARS = 180;
const AI_GEMINI_TIMEOUT_MS = 8000;
const AI_GEMINI_RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;
const AI_GEMINI_AUTH_BACKOFF_MS = 10 * 60 * 1000;
const AI_GEMINI_MIN_CALL_INTERVAL_MS = 7000;
const AI_GEMINI_MAX_OUTPUT_TOKENS = 96;
const AI_GEMINI_COMPLEX_MESSAGE_MIN_CHARS = 56;
const AI_GEMINI_CHAT_CALL_CHANCE = 0.35;
const AI_GEMINI_CONVERSATION_CALL_CHANCE = 0.22;
const AI_DECISION_CACHE_TTL_MS = 2 * 60 * 1000;
const AI_SPAWN_ID = "__ai_companions__";
const GEMINI_MODEL_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

export type EnemyType = "WARRIOR" | "MONK";
export type AiDisposition = "friendly" | "neutral" | "hostile";
export type AiPersonaId = "FALLEN_KNIGHT" | "LAST_MONK";

type PlayerRelationship = {
  trust: number;
  aggression: number;
  chats: number;
  attacksReceived: number;
  lastInteractionAtMs: number;
  notes: string[];
};

type MessageIntent = {
  greeting: boolean;
  askHelp: boolean;
  askJoin: boolean;
  apology: boolean;
  threat: boolean;
  praise: boolean;
  objectiveKill3: boolean;
};

type QueuedAiChatMessage = {
  dueAtMs: number;
  enemyId: number;
  text: string;
};

type CompanionDecision = {
  reply: string;
  mood: AiDisposition;
  followPlayer: boolean;
  attackPlayer: boolean;
  askAllyToSpeak: boolean;
  allyLine: string | null;
  memory: string | null;
};

type DecisionCacheEntry = {
  signature: string;
  cachedAtMs: number;
  decision: CompanionDecision;
};

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
const RELATION_BY_ENEMY_ID = new Map<number, Map<number, PlayerRelationship>>();
const AI_CHAT_QUEUE: QueuedAiChatMessage[] = [];
const enemyKillsByPlayerId = new Map<number, number>();
const aiChatInFlightByEnemyId = new Set<number>();
let aiConversationInFlight = false;
let nextAiConversationAtMs = 0;
let warnedMissingIaKey = false;
let geminiBlockedUntilMs = 0;
let lastGeminiCallAtMs = 0;
let nextEnemyId = 10000;
const DECISION_CACHE_BY_ENEMY_PLAYER = new Map<string, DecisionCacheEntry>();

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

function ensureRelationship(enemyId: number, playerId: number): PlayerRelationship {
  let mapByPlayer = RELATION_BY_ENEMY_ID.get(enemyId);
  if (!mapByPlayer) {
    mapByPlayer = new Map<number, PlayerRelationship>();
    RELATION_BY_ENEMY_ID.set(enemyId, mapByPlayer);
  }

  let relation = mapByPlayer.get(playerId);
  if (!relation) {
    relation = {
      trust: 0,
      aggression: 0,
      chats: 0,
      attacksReceived: 0,
      lastInteractionAtMs: 0,
      notes: []
    };
    mapByPlayer.set(playerId, relation);
  }

  return relation;
}

function remember(enemy: OnlineEnemyState, note: string): void {
  const normalized = note.trim().replace(/\s+/g, " ").slice(0, 200);
  if (!normalized) {
    return;
  }

  enemy.recentMemory.push(normalized);
  if (enemy.recentMemory.length > AI_MEMORY_LIMIT) {
    enemy.recentMemory.splice(0, enemy.recentMemory.length - AI_MEMORY_LIMIT);
  }
}

function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function parseIntent(rawText: string): MessageIntent {
  const text = normalizeSearchText(rawText);
  return {
    greeting:
      text.includes("oi") ||
      text.includes("ola") ||
      text.includes("eae") ||
      text.includes("salve") ||
      text.includes("hello"),
    askHelp:
      text.includes("ajuda") ||
      text.includes("help") ||
      text.includes("preciso de voce") ||
      text.includes("me acompanha") ||
      text.includes("acompanha"),
    askJoin:
      text.includes("junta") ||
      text.includes("join") ||
      text.includes("grupo") ||
      text.includes("party") ||
      text.includes("me siga") ||
      text.includes("me segue") ||
      text.includes("siga comigo") ||
      text.includes("segue comigo"),
    apology: text.includes("desculpa") || text.includes("perdao") || text.includes("foi mal"),
    threat:
      text.includes("vou te matar") ||
      text.includes("vou atacar") ||
      text.includes("idiota") ||
      text.includes("odio") ||
      text.includes("te odeio"),
    praise:
      text.includes("obrigado") ||
      text.includes("valeu") ||
      text.includes("bom trabalho") ||
      text.includes("forte"),
    objectiveKill3:
      /\b3\b\s*(npc|npcs|inimigo|inimigos)/.test(text) ||
      /tres\s*(npc|npcs|inimigo|inimigos)/.test(text)
  };
}

function applyIntentToRelationship(
  enemy: OnlineEnemyState,
  relation: PlayerRelationship,
  intent: MessageIntent,
  nowMs: number
): void {
  relation.chats += 1;
  relation.lastInteractionAtMs = nowMs;
  const isFallenKnight = enemy.aiPersonaId === "FALLEN_KNIGHT";

  if (intent.greeting) {
    relation.trust += isFallenKnight ? 3 : 6;
  }
  if (intent.askHelp || intent.askJoin) {
    relation.trust += isFallenKnight ? 2 : 8;
  }
  if (intent.praise) {
    relation.trust += 4;
    relation.aggression -= 3;
  }
  if (intent.apology) {
    relation.aggression -= 10;
    relation.trust += 3;
  }
  if (intent.threat) {
    relation.aggression += 20;
    relation.trust -= 10;
  }

  relation.trust = clamp(relation.trust, -100, 100);
  relation.aggression = clamp(relation.aggression, 0, 100);
}

function friendlyThresholdForEnemy(enemy: OnlineEnemyState): number {
  if (enemy.aiPersonaId === "FALLEN_KNIGHT") {
    return FALLEN_KNIGHT_FOLLOW_MIN_TRUST;
  }
  return AI_FRIENDLY_THRESHOLD;
}

function canEnemyFollowPlayer(
  enemy: OnlineEnemyState,
  relation: PlayerRelationship,
  playerId: number
): boolean {
  const killCount = enemyKillsByPlayerId.get(playerId) ?? 0;
  if (enemy.aiPersonaId === "FALLEN_KNIGHT") {
    return (
      killCount >= FALLEN_KNIGHT_FOLLOW_MIN_KILLS &&
      relation.trust >= FALLEN_KNIGHT_FOLLOW_MIN_TRUST &&
      relation.chats >= FALLEN_KNIGHT_FOLLOW_MIN_CHATS &&
      relation.attacksReceived === 0 &&
      relation.aggression < 45
    );
  }

  if (enemy.aiPersonaId === "LAST_MONK") {
    return relation.trust >= AI_FRIENDLY_THRESHOLD || (killCount >= 2 && relation.trust >= 24);
  }

  return relation.trust >= AI_FRIENDLY_THRESHOLD;
}

function fallenKnightPersuasionHint(playerName: string, relation: PlayerRelationship, killCount: number): string {
  const missing: string[] = [];
  if (killCount < FALLEN_KNIGHT_FOLLOW_MIN_KILLS) {
    missing.push(`derrotar ${FALLEN_KNIGHT_FOLLOW_MIN_KILLS} inimigos`);
  }
  if (relation.chats < FALLEN_KNIGHT_FOLLOW_MIN_CHATS) {
    missing.push("falar comigo com respeito");
  }
  if (relation.trust < FALLEN_KNIGHT_FOLLOW_MIN_TRUST) {
    missing.push("provar sua palavra");
  }

  if (missing.length === 0) {
    return `${playerName}, talvez eu considere sua proposta.`;
  }

  return `${playerName}, eu nao sigo ordens vazias. Primeiro: ${missing.join(", ")}.`;
}

function updateDispositionFromRelationship(
  enemy: OnlineEnemyState,
  relation: PlayerRelationship,
  playerId: number
): void {
  if (relation.aggression >= AI_HOSTILITY_THRESHOLD || relation.attacksReceived >= 3) {
    enemy.aiDisposition = "hostile";
    enemy.targetPlayerId = playerId;
    enemy.followPlayerId = null;
    return;
  }

  const friendlyThreshold = friendlyThresholdForEnemy(enemy);
  if (relation.trust >= friendlyThreshold && canEnemyFollowPlayer(enemy, relation, playerId)) {
    enemy.aiDisposition = "friendly";
    enemy.followPlayerId = playerId;
    enemy.targetPlayerId = null;
    return;
  }

  enemy.aiDisposition = "neutral";
  if (enemy.targetPlayerId === playerId && relation.aggression < 40) {
    enemy.targetPlayerId = null;
  }
}

function getEnemyById(enemyId: number): OnlineEnemyState | null {
  for (const list of DATA_BY_SPAWN.values()) {
    const enemy = list.find((entry) => entry.id === enemyId);
    if (enemy) {
      return enemy;
    }
  }
  return null;
}

function getAliveAiCompanions(nowMs = Date.now()): OnlineEnemyState[] {
  return getAllEnemies().filter(
    (enemy) => enemy.isAiCompanion && (enemy.deadUntilMs === null || enemy.deadUntilMs <= nowMs) && enemy.hp > 0
  );
}

function sanitizeAiChatText(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, " ").replace(/[\r\n]+/g, " ");
  if (!cleaned) {
    return "...";
  }
  return cleaned.slice(0, AI_CHAT_MAX_CHARS);
}

function queueAiMessage(enemyId: number, text: string, delayMs = 900): void {
  AI_CHAT_QUEUE.push({
    enemyId,
    text: sanitizeAiChatText(text),
    dueAtMs: Date.now() + Math.max(0, delayMs)
  });
}

function applyConversationPause(enemy: OnlineEnemyState, nowMs: number, textLength = 0): void {
  const duration = clamp(
    AI_RESPONSE_PAUSE_BASE_MS + textLength * 12,
    AI_RESPONSE_PAUSE_BASE_MS,
    AI_RESPONSE_PAUSE_MAX_MS
  );
  enemy.pauseUntilMs = Math.max(enemy.pauseUntilMs, nowMs + duration);
  enemy.inputX = 0;
  enemy.inputY = 0;
  enemy.moving = false;
}

function relationBucket(value: number): number {
  return Math.round(value / 10) * 10;
}

function buildDecisionSignature(
  messageText: string,
  relation: PlayerRelationship,
  killCount: number
): string {
  return [
    normalizeSearchText(messageText).slice(0, 96),
    `t${relationBucket(relation.trust)}`,
    `a${relationBucket(relation.aggression)}`,
    `k${killCount >= 3 ? "3p" : String(killCount)}`,
    `atk${Math.min(4, relation.attacksReceived)}`
  ].join("|");
}

function decisionCacheKey(enemyId: number, playerId: number): string {
  return `${enemyId}:${playerId}`;
}

function getCachedDecision(
  enemyId: number,
  playerId: number,
  signature: string,
  nowMs: number
): CompanionDecision | null {
  const key = decisionCacheKey(enemyId, playerId);
  const cached = DECISION_CACHE_BY_ENEMY_PLAYER.get(key);
  if (!cached) {
    return null;
  }

  if (cached.signature !== signature) {
    return null;
  }

  if (nowMs - cached.cachedAtMs > AI_DECISION_CACHE_TTL_MS) {
    DECISION_CACHE_BY_ENEMY_PLAYER.delete(key);
    return null;
  }

  return cached.decision;
}

function setCachedDecision(
  enemyId: number,
  playerId: number,
  signature: string,
  decision: CompanionDecision,
  nowMs: number
): void {
  const key = decisionCacheKey(enemyId, playerId);
  DECISION_CACHE_BY_ENEMY_PLAYER.set(key, {
    signature,
    cachedAtMs: nowMs,
    decision
  });
}

function shouldUseGeminiForPlayerDecision(
  messageText: string,
  intent: MessageIntent,
  relation: PlayerRelationship,
  nowMs: number
): boolean {
  if (geminiBlockedUntilMs > nowMs) {
    return false;
  }

  if (nowMs - lastGeminiCallAtMs < AI_GEMINI_MIN_CALL_INTERVAL_MS) {
    return false;
  }

  const isSimpleIntent =
    intent.greeting ||
    intent.askHelp ||
    intent.askJoin ||
    intent.apology ||
    intent.threat ||
    intent.praise ||
    intent.objectiveKill3;

  if (isSimpleIntent && messageText.length < AI_GEMINI_COMPLEX_MESSAGE_MIN_CHARS) {
    return false;
  }

  if (relation.chats <= 1) {
    return false;
  }

  if (messageText.length >= AI_GEMINI_COMPLEX_MESSAGE_MIN_CHARS) {
    return true;
  }

  if (messageText.includes("?") && messageText.length >= 20) {
    return Math.random() < AI_GEMINI_CHAT_CALL_CHANCE;
  }

  return false;
}

function shouldUseGeminiForCompanionConversation(
  nowMs: number,
  players: Array<{ id: number; x: number; y: number }>,
  speaker: OnlineEnemyState,
  listener: OnlineEnemyState
): boolean {
  if (geminiBlockedUntilMs > nowMs) {
    return false;
  }

  if (nowMs - lastGeminiCallAtMs < AI_GEMINI_MIN_CALL_INTERVAL_MS) {
    return false;
  }

  const hasNearbyPlayer = players.some((player) => {
    const d1 = Math.hypot(player.x - speaker.x, player.y - speaker.y);
    const d2 = Math.hypot(player.x - listener.x, player.y - listener.y);
    return d1 <= 12 || d2 <= 12;
  });
  if (!hasNearbyPlayer) {
    return false;
  }

  return Math.random() < AI_GEMINI_CONVERSATION_CALL_CHANCE;
}

function getGeminiApiKey(): string | null {
  const key = env.IAKEY?.trim() ?? "";
  if (key.length > 0) {
    return key;
  }

  if (!warnedMissingIaKey) {
    warnedMissingIaKey = true;
    logWarn("AI", "IAKEY ausente; companheiros usando fallback local");
  }
  return null;
}

function extractJsonObject(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch && fencedMatch[1]) {
    const candidate = fencedMatch[1].trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) {
      return candidate;
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return null;
}

async function askGeminiJson(prompt: string): Promise<Record<string, unknown> | null> {
  const nowMs = Date.now();
  if (geminiBlockedUntilMs > nowMs) {
    return null;
  }

  if (nowMs - lastGeminiCallAtMs < AI_GEMINI_MIN_CALL_INTERVAL_MS) {
    return null;
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_GEMINI_TIMEOUT_MS);

  try {
    lastGeminiCallAtMs = Date.now();
    const response = await fetch(`${GEMINI_MODEL_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.6,
          maxOutputTokens: AI_GEMINI_MAX_OUTPUT_TOKENS
        }
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      if (response.status === 429) {
        geminiBlockedUntilMs = Date.now() + AI_GEMINI_RATE_LIMIT_BACKOFF_MS;
        logWarn("AI", "Falha HTTP no Gemini (rate limit)", {
          status: response.status,
          retryInSec: Math.round((geminiBlockedUntilMs - Date.now()) / 1000),
          body: errorBody.slice(0, 160)
        });
        return null;
      }

      if (response.status === 401 || response.status === 403) {
        geminiBlockedUntilMs = Date.now() + AI_GEMINI_AUTH_BACKOFF_MS;
      }

      logWarn("AI", "Falha HTTP no Gemini", {
        status: response.status,
        body: errorBody.slice(0, 160)
      });
      return null;
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      return null;
    }

    const jsonText = extractJsonObject(text);
    if (!jsonText) {
      return null;
    }

    const parsed = JSON.parse(jsonText) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    logWarn("AI", "Erro ao consultar Gemini", {
      message: error instanceof Error ? error.message : "erro desconhecido"
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function personaDescription(personaId: AiPersonaId | null): string {
  if (personaId === "FALLEN_KNIGHT") {
    return "cavaleiro sombrio, direto e honrado";
  }
  if (personaId === "LAST_MONK") {
    return "monge calmo, estrategista e protetor";
  }
  return "companheiro";
}

function randomFrom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function fallbackReply(
  enemy: OnlineEnemyState,
  playerName: string,
  relation: PlayerRelationship,
  intent: MessageIntent,
  killCount: number
): CompanionDecision {
  const angry = relation.aggression >= AI_HOSTILITY_THRESHOLD;
  const friendly = relation.trust >= AI_FRIENDLY_THRESHOLD;
  const canFollowFallenKnight =
    killCount >= FALLEN_KNIGHT_FOLLOW_MIN_KILLS &&
    relation.trust >= FALLEN_KNIGHT_FOLLOW_MIN_TRUST &&
    relation.chats >= FALLEN_KNIGHT_FOLLOW_MIN_CHATS &&
    relation.attacksReceived === 0 &&
    relation.aggression < 45;

  if (angry || intent.threat) {
    return {
      reply: `${playerName}, mantenha distancia. Mais um golpe e eu revido.`,
      mood: "hostile",
      followPlayer: false,
      attackPlayer: true,
      askAllyToSpeak: false,
      allyLine: null,
      memory: `Avaliou ${playerName} como ameaca.`
    };
  }

  if (enemy.aiPersonaId === "FALLEN_KNIGHT" && (intent.askHelp || intent.askJoin)) {
    if (!canFollowFallenKnight) {
      return {
        reply: fallenKnightPersuasionHint(playerName, relation, killCount),
        mood: "neutral",
        followPlayer: false,
        attackPlayer: false,
        askAllyToSpeak: false,
        allyLine: null,
        memory: `Recusou seguir ${playerName} por falta de persuasao.`
      };
    }
  }

  if ((intent.askHelp || intent.askJoin || intent.objectiveKill3) && killCount >= 3) {
    return {
      reply: `${playerName}, voce provou valor. Eu e meu aliado vamos com voce.`,
      mood: "friendly",
      followPlayer: true,
      attackPlayer: false,
      askAllyToSpeak: true,
      allyLine: `Entendido, ${playerName}. Seguiremos voce por enquanto.`,
      memory: `Aceitou seguir ${playerName} apos objetivo de combate.`
    };
  }

  if (friendly || intent.greeting || intent.praise) {
    return {
      reply:
        enemy.aiPersonaId === "LAST_MONK"
          ? `Ola ${playerName}. Estou bem. Se precisar, posso manter voce de pe.`
          : `Ola ${playerName}. Estou firme. Diga o proximo passo.`,
      mood: "friendly",
      followPlayer: intent.askHelp || intent.askJoin,
      attackPlayer: false,
      askAllyToSpeak: intent.askJoin,
      allyLine: "Vamos observar voce de perto.",
      memory: `Interacao amigavel com ${playerName}.`
    };
  }

  return {
    reply: `${playerName}, estamos atentos. Mostre suas intencoes.`,
    mood: "neutral",
    followPlayer: false,
    attackPlayer: false,
    askAllyToSpeak: false,
    allyLine: null,
    memory: `Manteve postura neutra com ${playerName}.`
  };
}

function parseDecision(
  raw: Record<string, unknown> | null,
  fallback: CompanionDecision
): CompanionDecision {
  if (!raw) {
    return fallback;
  }

  const moodRaw = typeof raw.mood === "string" ? raw.mood.toLowerCase() : "";
  const mood: AiDisposition =
    moodRaw === "friendly" || moodRaw === "hostile" || moodRaw === "neutral"
      ? moodRaw
      : fallback.mood;

  const reply =
    typeof raw.reply === "string" && raw.reply.trim().length > 0
      ? sanitizeAiChatText(raw.reply)
      : fallback.reply;

  const allyLine =
    typeof raw.allyLine === "string" && raw.allyLine.trim().length > 0
      ? sanitizeAiChatText(raw.allyLine)
      : fallback.allyLine;

  const memory =
    typeof raw.memory === "string" && raw.memory.trim().length > 0
      ? sanitizeAiChatText(raw.memory)
      : fallback.memory;

  return {
    reply,
    mood,
    followPlayer: typeof raw.followPlayer === "boolean" ? raw.followPlayer : fallback.followPlayer,
    attackPlayer: typeof raw.attackPlayer === "boolean" ? raw.attackPlayer : fallback.attackPlayer,
    askAllyToSpeak:
      typeof raw.askAllyToSpeak === "boolean" ? raw.askAllyToSpeak : fallback.askAllyToSpeak,
    allyLine,
    memory
  };
}

async function reactCompanionToPlayerMessage(
  enemy: OnlineEnemyState,
  player: { id: number; name: string; x: number; y: number; hp: number; maxHp: number },
  messageText: string,
  nowMs: number
): Promise<void> {
  if (aiChatInFlightByEnemyId.has(enemy.id)) {
    return;
  }

  aiChatInFlightByEnemyId.add(enemy.id);
  try {
    const relation = ensureRelationship(enemy.id, player.id);
    const intent = parseIntent(messageText);
    applyIntentToRelationship(enemy, relation, intent, nowMs);
    applyConversationPause(enemy, nowMs, messageText.length);

    const killCount = enemyKillsByPlayerId.get(player.id) ?? 0;
    if (intent.objectiveKill3) {
      if (killCount >= 3) {
        relation.trust = clamp(relation.trust + 16, -100, 100);
        relation.aggression = clamp(relation.aggression - 10, 0, 100);
      } else {
        relation.trust = clamp(relation.trust + 2, -100, 100);
      }
    }

    updateDispositionFromRelationship(enemy, relation, player.id);

    const fallback = fallbackReply(enemy, player.name, relation, intent, killCount);
    const signature = buildDecisionSignature(messageText, relation, killCount);
    const cachedDecision = getCachedDecision(enemy.id, player.id, signature, nowMs);

    let decision: CompanionDecision = fallback;
    if (cachedDecision) {
      decision = cachedDecision;
    } else if (shouldUseGeminiForPlayerDecision(messageText, intent, relation, nowMs)) {
      const prompt = [
        "NPC RPG. Responda apenas JSON curto.",
        `npc=${enemy.name};persona=${personaDescription(enemy.aiPersonaId)}`,
        `player=${player.name};hp=${player.hp}/${player.maxHp}`,
        `rel t=${relation.trust} a=${relation.aggression} atk=${relation.attacksReceived} chats=${relation.chats} kills=${killCount}`,
        `msg=${sanitizeAiChatText(messageText).slice(0, 128)}`,
        `mem=${enemy.recentMemory.slice(-2).join(" || ") || "-"}`,
        'json={"reply":"pt-BR curto","mood":"friendly|neutral|hostile","followPlayer":true,"attackPlayer":false,"askAllyToSpeak":false,"allyLine":"","memory":""}'
      ].join("\n");

      const rawDecision = await askGeminiJson(prompt);
      decision = parseDecision(rawDecision, fallback);
      if (rawDecision) {
        setCachedDecision(enemy.id, player.id, signature, decision, nowMs);
      }
    }

    const canFollowNow = canEnemyFollowPlayer(enemy, relation, player.id);
    if (!canFollowNow) {
      decision.followPlayer = false;
      if (decision.mood === "friendly") {
        decision.mood = "neutral";
      }
      if (
        enemy.aiPersonaId === "FALLEN_KNIGHT" &&
        (intent.askJoin || intent.askHelp || intent.objectiveKill3)
      ) {
        decision.reply = fallenKnightPersuasionHint(player.name, relation, killCount);
      }
    }

    enemy.aiDisposition = decision.mood;
    enemy.lastAiInteractionAtMs = nowMs;

    if (decision.attackPlayer || decision.mood === "hostile") {
      enemy.targetPlayerId = player.id;
      enemy.followPlayerId = null;
      relation.aggression = clamp(Math.max(relation.aggression, 70), 0, 100);
    } else if (decision.followPlayer || decision.mood === "friendly") {
      enemy.followPlayerId = player.id;
      enemy.targetPlayerId = null;
      relation.trust = clamp(Math.max(relation.trust, 35), -100, 100);
      relation.aggression = clamp(relation.aggression - 2, 0, 100);
    } else if (enemy.targetPlayerId === player.id && relation.aggression < 55) {
      enemy.targetPlayerId = null;
    }

    relation.notes.push(`msg:${sanitizeAiChatText(messageText).slice(0, 72)}`);
    if (relation.notes.length > 8) {
      relation.notes.splice(0, relation.notes.length - 8);
    }

    const memoryNote = decision.memory ?? fallback.memory;
    if (memoryNote) {
      remember(enemy, `${new Date(nowMs).toISOString()} ${memoryNote}`);
    }

    applyConversationPause(enemy, nowMs, decision.reply.length);
    queueAiMessage(enemy.id, decision.reply, randomInt(600, 1200));

    if (decision.askAllyToSpeak) {
      const ally = enemy.allyEnemyId !== null ? getEnemyById(enemy.allyEnemyId) : null;
      if (ally && ally.isAiCompanion && ally.deadUntilMs === null) {
        const allyText = decision.allyLine ?? `${player.name}, estou atento ao que acontece aqui.`;
        applyConversationPause(ally, nowMs, allyText.length);
        queueAiMessage(ally.id, allyText, randomInt(1200, 2000));
      }
    }

    logInfo("AI", "NPC respondeu jogador", {
      npc: enemy.name,
      player: player.name,
      mood: enemy.aiDisposition,
      trust: relation.trust,
      aggression: relation.aggression
    });
  } catch (error) {
    logError("AI", "Falha no processamento de chat do companion", {
      npc: enemy.name,
      player: player.name,
      error: error instanceof Error ? error.message : "erro desconhecido"
    });
  } finally {
    aiChatInFlightByEnemyId.delete(enemy.id);
  }
}

async function runCompanionConversation(
  nowMs: number,
  players: Array<{ id: number; x: number; y: number }>
): Promise<void> {
  const companions = getAliveAiCompanions(nowMs);
  if (companions.length < 2) {
    return;
  }

  const speaker = randomFrom(companions);
  const listener = companions.find((entry) => entry.id !== speaker.id) ?? companions[0];
  if (!speaker || !listener || speaker.id === listener.id) {
    return;
  }

  const dist = Math.hypot(speaker.x - listener.x, speaker.y - listener.y);
  if (dist > 7) {
    return;
  }

  const fallbackLine =
    speaker.aiPersonaId === "LAST_MONK"
      ? "O equilibrio deste vale mudou. Mantenha os olhos no horizonte."
      : "Fique pronto. O proximo conflito esta perto.";
  const fallbackResponse =
    listener.aiPersonaId === "LAST_MONK"
      ? "Entendido. Vou manter nossa posicao."
      : "Estou pronto. Ninguem nos pega desprevenidos.";

  let raw: Record<string, unknown> | null = null;
  if (shouldUseGeminiForCompanionConversation(nowMs, players, speaker, listener)) {
    const prompt = [
      "Dois NPCs RPG. Responda JSON curto.",
      `A=${speaker.name}:${personaDescription(speaker.aiPersonaId)}`,
      `B=${listener.name}:${personaDescription(listener.aiPersonaId)}`,
      `memA=${speaker.recentMemory.slice(-2).join(" || ") || "-"}`,
      `memB=${listener.recentMemory.slice(-2).join(" || ") || "-"}`,
      'json={"line":"fala curta","listenerLine":"resposta curta","memory":"nota"}'
    ].join("\n");
    raw = await askGeminiJson(prompt);
  }
  const line =
    typeof raw?.line === "string" && raw.line.trim().length > 0
      ? sanitizeAiChatText(raw.line)
      : fallbackLine;
  const listenerLine =
    typeof raw?.listenerLine === "string" && raw.listenerLine.trim().length > 0
      ? sanitizeAiChatText(raw.listenerLine)
      : fallbackResponse;
  const memoryNote =
    typeof raw?.memory === "string" && raw.memory.trim().length > 0
      ? sanitizeAiChatText(raw.memory)
      : "Conversa interna entre companheiros.";

  applyConversationPause(speaker, nowMs, line.length);
  applyConversationPause(listener, nowMs + 400, listenerLine.length);
  queueAiMessage(speaker.id, line, randomInt(500, 1000));
  queueAiMessage(listener.id, listenerLine, randomInt(1300, 2100));

  remember(speaker, `${new Date(nowMs).toISOString()} ${memoryNote}`);
  remember(listener, `${new Date(nowMs).toISOString()} ${memoryNote}`);
}

function registerCompanionAttack(enemy: OnlineEnemyState, attackerId: number, nowMs: number): void {
  const attacker = buildPublicPlayersSnapshot().find((player) => player.id === attackerId) ?? null;
  const attackerName = attacker?.name ?? `Player#${attackerId}`;
  const relation = ensureRelationship(enemy.id, attackerId);
  relation.attacksReceived += 1;
  relation.aggression = clamp(relation.aggression + 28, 0, 100);
  relation.trust = clamp(relation.trust - 12, -100, 100);
  relation.lastInteractionAtMs = nowMs;

  updateDispositionFromRelationship(enemy, relation, attackerId);
  remember(enemy, `${new Date(nowMs).toISOString()} sofreu ataque de ${attackerName}`);

  if (nowMs - enemy.lastAiInteractionAtMs > AI_INTERACT_COOLDOWN_MS) {
    enemy.lastAiInteractionAtMs = nowMs;
    queueAiMessage(enemy.id, `${attackerName}, isso foi um erro.`, randomInt(300, 700));
  }
}

function updateAiTargeting(
  enemy: OnlineEnemyState,
  playerPositions: Array<{ characterId: number; x: number; y: number }>
): void {
  const playersById = new Map(playerPositions.map((player) => [player.characterId, player]));

  if (enemy.aiDisposition === "hostile") {
    if (enemy.targetPlayerId !== null) {
      const target = playersById.get(enemy.targetPlayerId);
      if (!target || Math.hypot(target.x - enemy.x, target.y - enemy.y) > AI_HOSTILE_CHASE_RADIUS) {
        enemy.targetPlayerId = null;
      }
    }

    if (enemy.targetPlayerId === null) {
      const relations = RELATION_BY_ENEMY_ID.get(enemy.id);
      let bestPlayerId: number | null = null;
      let bestScore = -1;

      if (relations) {
        for (const [playerId, relation] of relations.entries()) {
          const player = playersById.get(playerId);
          if (!player) {
            continue;
          }
          const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
          if (dist > AI_HOSTILE_CHASE_RADIUS) {
            continue;
          }
          if (relation.aggression > bestScore) {
            bestScore = relation.aggression;
            bestPlayerId = playerId;
          }
        }
      }

      enemy.targetPlayerId = bestPlayerId;
    }

    return;
  }

  enemy.targetPlayerId = null;

  if (enemy.aiDisposition === "friendly") {
    if (enemy.followPlayerId !== null) {
      const followed = playersById.get(enemy.followPlayerId);
      const relation = ensureRelationship(enemy.id, enemy.followPlayerId);
      if (!followed || !canEnemyFollowPlayer(enemy, relation, enemy.followPlayerId)) {
        enemy.followPlayerId = null;
      }
    }

    if (enemy.followPlayerId === null) {
      const relations = RELATION_BY_ENEMY_ID.get(enemy.id);
      let bestPlayerId: number | null = null;
      let bestTrust = AI_FRIENDLY_THRESHOLD;
      if (relations) {
        for (const [playerId, relation] of relations.entries()) {
          const player = playersById.get(playerId);
          if (!player) {
            continue;
          }
          const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
          if (dist > AI_HOSTILE_CHASE_RADIUS) {
            continue;
          }
          if (relation.trust >= bestTrust) {
            if (!canEnemyFollowPlayer(enemy, relation, playerId)) {
              continue;
            }
            bestTrust = relation.trust;
            bestPlayerId = playerId;
          }
        }
      }
      enemy.followPlayerId = bestPlayerId;
    }
  } else if (enemy.aiDisposition === "neutral") {
    enemy.followPlayerId = null;
  }
}

export function registerEnemySpawns(spawns: EnemySpawnDefinition[]): void {
  DATA_BY_SPAWN.clear();
  RELATION_BY_ENEMY_ID.clear();
  AI_CHAT_QUEUE.length = 0;
  enemyKillsByPlayerId.clear();
  aiChatInFlightByEnemyId.clear();
  DECISION_CACHE_BY_ENEMY_PLAYER.clear();
  aiConversationInFlight = false;
  nextAiConversationAtMs = Date.now() + randomInt(7000, 12000);
  lastGeminiCallAtMs = 0;
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

  logInfo("AI", "Companheiros IA iniciados", {
    npc1: `${companions[0]?.name ?? "?"}(${companions[0]?.id ?? -1})`,
    npc2: `${companions[1]?.name ?? "?"}(${companions[1]?.id ?? -1})`,
    x: companions[0]?.x ?? -1,
    y: companions[0]?.y ?? -1
  });
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
  const normalizedText = text.trim();
  if (normalizedText.length === 0) {
    return;
  }

  const player = buildPublicPlayersSnapshot().find((entry) => entry.id === playerId);
  if (!player) {
    return;
  }

  const nowMs = Date.now();
  const aliveCompanions = getAliveAiCompanions(nowMs);
  if (aliveCompanions.length === 0) {
    return;
  }

  const nearbyCompanions = aliveCompanions
    .map((enemy) => ({
      enemy,
      dist: Math.hypot(enemy.x - player.x, enemy.y - player.y)
    }))
    .filter((entry) => entry.dist <= AI_CHAT_RADIUS)
    .sort((a, b) => a.dist - b.dist);

  if (nearbyCompanions.length === 0) {
    return;
  }

  const lowered = normalizeSearchText(normalizedText);
  const directlyMentioned = nearbyCompanions
    .filter((entry) => lowered.includes(normalizeSearchText(entry.enemy.name)))
    .map((entry) => entry.enemy);

  const targets = directlyMentioned.length > 0 ? [directlyMentioned[0]] : [nearbyCompanions[0].enemy];
  for (const enemy of targets) {
    if (
      directlyMentioned.length === 0 &&
      nowMs - enemy.lastAiInteractionAtMs < AI_INTERACT_COOLDOWN_MS
    ) {
      continue;
    }

    applyConversationPause(enemy, nowMs, normalizedText.length);
    void reactCompanionToPlayerMessage(
      enemy,
      {
        id: player.id,
        name: playerName,
        x: player.x,
        y: player.y,
        hp: player.hp,
        maxHp: player.maxHp
      },
      normalizedText,
      nowMs
    );
  }
}

export function tickAiCompanionDirector(nowMs = Date.now()): void {
  const companions = getAliveAiCompanions(nowMs);
  if (companions.length === 0) {
    return;
  }

  const onlinePlayers = buildPublicPlayersSnapshot();
  const playersById = new Map(onlinePlayers.map((player) => [player.id, player]));
  if (onlinePlayers.length === 0) {
    nextAiConversationAtMs = nowMs + AI_INTER_COMMS_INTERVAL_MS;
    return;
  }

  for (const companion of companions) {
    if (companion.followPlayerId !== null && !playersById.has(companion.followPlayerId)) {
      companion.followPlayerId = null;
    }
    if (companion.targetPlayerId !== null && !playersById.has(companion.targetPlayerId)) {
      companion.targetPlayerId = null;
    }
  }

  if (nowMs < nextAiConversationAtMs || aiConversationInFlight) {
    return;
  }

  aiConversationInFlight = true;
  nextAiConversationAtMs = nowMs + AI_INTER_COMMS_INTERVAL_MS + randomInt(0, 8000);

  void runCompanionConversation(
    nowMs,
    onlinePlayers.map((player) => ({ id: player.id, x: player.x, y: player.y }))
  )
    .catch((error) => {
      logError("AI", "Falha em conversa entre companheiros", {
        error: error instanceof Error ? error.message : "erro desconhecido"
      });
    })
    .finally(() => {
      aiConversationInFlight = false;
    });
}

export function consumePendingAiChatMessages(
  nowMs = Date.now()
): Array<{ enemyId: number; enemyName: string; text: string }> {
  if (AI_CHAT_QUEUE.length === 0) {
    return [];
  }

  AI_CHAT_QUEUE.sort((a, b) => a.dueAtMs - b.dueAtMs);
  const ready: Array<{ enemyId: number; enemyName: string; text: string }> = [];

  while (AI_CHAT_QUEUE.length > 0 && AI_CHAT_QUEUE[0].dueAtMs <= nowMs) {
    const nextMessage = AI_CHAT_QUEUE.shift();
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
  for (const enemies of DATA_BY_SPAWN.values()) {
    for (const enemy of enemies) {
      if (enemy.deadUntilMs !== null && enemy.deadUntilMs > Date.now()) {
        continue;
      }

      const now = Date.now();
      const lastAttackerId = attackedByPlayerId(enemy.id);
<<<<<<< Updated upstream

      if (enemy.isAiCompanion) {
        if (lastAttackerId !== null) {
          const relation = ensureRelationship(enemy.id, lastAttackerId);
          if (now - relation.lastInteractionAtMs > 800) {
            relation.aggression = clamp(relation.aggression + 3, 0, 100);
            relation.lastInteractionAtMs = now;
          }
        }
        updateAiTargeting(enemy, playerPositions);
        continue;
      }

      if (lastAttackerId !== null) {
        const lastAttacker = playersById.get(lastAttackerId);
        if (lastAttacker && !lastAttacker.isSpawnProtected) {
          enemy.targetPlayerId = lastAttackerId;
          enemy.lastTargetChangeAtMs = now;
        }
=======

      if (enemy.isAiCompanion) {
        if (lastAttackerId !== null) {
          const relation = ensureRelationship(enemy.id, lastAttackerId);
          if (now - relation.lastInteractionAtMs > 800) {
            relation.aggression = clamp(relation.aggression + 3, 0, 100);
            relation.lastInteractionAtMs = now;
          }
        }
        updateAiTargeting(enemy, playerPositions);
        continue;
      }

      if (lastAttackerId !== null) {
        enemy.targetPlayerId = lastAttackerId;
        enemy.lastTargetChangeAtMs = now;
>>>>>>> Stashed changes
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
      if (targetPlayer.isSpawnProtected) {
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
      registerCompanionAttack(enemy, attacker.characterId, Date.now());
    }

    enemy.hp = Math.max(0, enemy.hp - damageAmount);
    const died = enemy.hp === 0;

    if (died) {
      enemy.deadUntilMs = Date.now() + ENEMY_RESPAWN_DELAY_MS;
      enemy.targetPlayerId = null;
      enemy.followPlayerId = null;
      enemy.isAttacking = false;

      const currentKills = enemyKillsByPlayerId.get(attacker.characterId) ?? 0;
      enemyKillsByPlayerId.set(attacker.characterId, currentKills + 1);

      if (enemy.isAiCompanion) {
        queueAiMessage(enemy.id, "Eu volto em breve... isto nao acabou.", randomInt(250, 500));
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
