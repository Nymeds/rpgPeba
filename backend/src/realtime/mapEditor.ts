import { MAP_SIZE } from "../game.js";
import type { EnemySpawnDefinition } from "./enemies.js";

export const DEFAULT_MAP_KEY = "default";
const DEFAULT_MAP_NAME = "Mapa Principal";

export type MapObjectDefinition = {
  id: string;
  name: string;
  imageDataUrl: string;
  maskWidth: number;
  maskHeight: number;
  solid: boolean;
  cropX: number | null;
  cropY: number | null;
  cropWidth: number | null;
  cropHeight: number | null;
};

export type MapLayerDefinition = {
  id: string;
  name: string;
  visible: boolean;
  tiles: Array<Array<string | null>>;
};

export type PersistedMapData = {
  mapSize: number;
  objects: MapObjectDefinition[];
  layers: MapLayerDefinition[];
  enemySpawns?: EnemySpawnDefinition[];
};

function criarGradeVazia(): Array<Array<string | null>> {
  // Tecnico: Grid quadrada fixa no tamanho do mapa do jogo.
  // Crianca: Cria um tabuleiro vazio para desenhar.
  return Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => null));
}

export function criarMapaPadrao(): PersistedMapData {
  return {
    mapSize: MAP_SIZE,
    objects: [],
    layers: [
      {
        id: "layer-ground",
        name: "Chao",
        visible: true,
        tiles: criarGradeVazia()
      }
    ],
    enemySpawns: []
  };
}

function normalizarTexto(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  return trimmed.slice(0, maxLength);
}

function normalizarNumeroInteiro(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizarTiles(rawTiles: unknown): Array<Array<string | null>> {
  const empty = criarGradeVazia();
  if (!Array.isArray(rawTiles) || rawTiles.length !== MAP_SIZE) {
    return empty;
  }

  return rawTiles.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== MAP_SIZE) {
      return empty[rowIndex];
    }
    return row.map((cell) => (typeof cell === "string" && cell.trim().length > 0 ? cell : null));
  });
}

function normalizarMapa(rawMap: unknown): PersistedMapData {
  const fallback = criarMapaPadrao();
  if (!rawMap || typeof rawMap !== "object") {
    return fallback;
  }

  const source = rawMap as Partial<PersistedMapData>;
  const rawObjects = Array.isArray(source.objects) ? source.objects : [];
  const rawLayers = Array.isArray(source.layers) ? source.layers : [];
  const rawEnemySpawns = Array.isArray(source.enemySpawns) ? source.enemySpawns : [];

  const objects: MapObjectDefinition[] = [];
  const objectIds = new Set<string>();
  for (const raw of rawObjects) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const object = raw as Partial<MapObjectDefinition>;
    const id = normalizarTexto(object.id, `obj-${objects.length + 1}`, 48);
    if (objectIds.has(id)) {
      continue;
    }
    objectIds.add(id);
    objects.push({
      id,
      name: normalizarTexto(object.name, `Objeto ${objects.length + 1}`, 40),
      imageDataUrl: normalizarTexto(object.imageDataUrl, "", 2_000_000),
      maskWidth: normalizarNumeroInteiro(object.maskWidth, 1, 8, 1),
      maskHeight: normalizarNumeroInteiro(object.maskHeight, 1, 8, 1),
      solid: Boolean(object.solid),
      cropX:
        object.cropX === null || object.cropX === undefined
          ? null
          : normalizarNumeroInteiro(object.cropX, 0, 20_000, 0),
      cropY:
        object.cropY === null || object.cropY === undefined
          ? null
          : normalizarNumeroInteiro(object.cropY, 0, 20_000, 0),
      cropWidth:
        object.cropWidth === null || object.cropWidth === undefined
          ? null
          : normalizarNumeroInteiro(object.cropWidth, 1, 20_000, 1),
      cropHeight:
        object.cropHeight === null || object.cropHeight === undefined
          ? null
          : normalizarNumeroInteiro(object.cropHeight, 1, 20_000, 1)
    });
  }

  const layers: MapLayerDefinition[] = [];
  const layerIds = new Set<string>();
  for (const raw of rawLayers) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const layer = raw as Partial<MapLayerDefinition>;
    const id = normalizarTexto(layer.id, `layer-${layers.length + 1}`, 48);
    if (layerIds.has(id)) {
      continue;
    }
    layerIds.add(id);
    layers.push({
      id,
      name: normalizarTexto(layer.name, `Layer ${layers.length + 1}`, 40),
      visible: layer.visible !== false,
      tiles: normalizarTiles(layer.tiles)
    });
  }

  const enemySpawns: EnemySpawnDefinition[] = [];
  const spawnIds = new Set<string>();
  for (const raw of rawEnemySpawns) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const spawn = raw as Partial<EnemySpawnDefinition>;
    const id = normalizarTexto(spawn.id, `spawn-${enemySpawns.length + 1}`, 48);
    if (spawnIds.has(id)) {
      continue;
    }
    spawnIds.add(id);
    enemySpawns.push({
      id,
      name: normalizarTexto(spawn.name, `Inimigo ${enemySpawns.length + 1}`, 40),
      x: normalizarNumeroInteiro(spawn.x, 0, 79, 0),
      y: normalizarNumeroInteiro(spawn.y, 0, 79, 0),
      enemyType: (spawn.enemyType === "MONK" ? "MONK" : "WARRIOR") as "WARRIOR" | "MONK",
      spawnCount: normalizarNumeroInteiro(spawn.spawnCount, 1, 10, 1)
    });
  }

  if (layers.length === 0) {
    return fallback;
  }

  return {
    mapSize: MAP_SIZE,
    objects,
    layers,
    enemySpawns
  };
}

export function parsearMapaSalvo(rawData: string): PersistedMapData {
  try {
    const parsed = JSON.parse(rawData) as unknown;
    return normalizarMapa(parsed);
  } catch {
    return criarMapaPadrao();
  }
}

export function serializarMapa(data: PersistedMapData): string {
  return JSON.stringify(normalizarMapa(data));
}

export function normalizarMapKey(rawMapKey: unknown): string {
  if (typeof rawMapKey !== "string") {
    return DEFAULT_MAP_KEY;
  }
  const trimmed = rawMapKey.trim().toLowerCase();
  if (trimmed.length === 0) {
    return DEFAULT_MAP_KEY;
  }
  return trimmed.slice(0, 32);
}

export function nomeMapaPadrao(): string {
  return DEFAULT_MAP_NAME;
}

let gradeSolidaAtual: boolean[][] = Array.from({ length: MAP_SIZE }, () =>
  Array.from({ length: MAP_SIZE }, () => false)
);
let mapRevisionAtual = 0;
let mapaAtualizadoPendente = false;

export function atualizarGradeSolida(data: PersistedMapData): void {
  const normalized = normalizarMapa(data);
  const objetosSolidos = new Set(normalized.objects.filter((entry) => entry.solid).map((entry) => entry.id));
  const nextGrid = Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => false));

  for (const layer of normalized.layers) {
    for (let y = 0; y < MAP_SIZE; y += 1) {
      for (let x = 0; x < MAP_SIZE; x += 1) {
        const objectId = layer.tiles[y]?.[x] ?? null;
        if (objectId && objetosSolidos.has(objectId)) {
          nextGrid[y][x] = true;
        }
      }
    }
  }

  gradeSolidaAtual = nextGrid;
}

export function tileSolido(tileX: number, tileY: number): boolean {
  if (tileX < 0 || tileY < 0 || tileX >= MAP_SIZE || tileY >= MAP_SIZE) {
    return true;
  }
  return gradeSolidaAtual[tileY][tileX];
}

export function sinalizarMapaAtualizado(): void {
  mapRevisionAtual += 1;
  mapaAtualizadoPendente = true;
}

export function obterMapRevision(): number {
  return mapRevisionAtual;
}

export function consumirSinalMapaAtualizado(): boolean {
  if (!mapaAtualizadoPendente) {
    return false;
  }
  mapaAtualizadoPendente = false;
  return true;
}
