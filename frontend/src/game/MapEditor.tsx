import { type ChangeEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";

import { API_URL } from "../api";
import type { GameMapDefinition, MapLayerDefinition, MapObjectDefinition, EnemySpawnDefinition } from "../types";

const EDITOR_TILE_SIZE = 22;
const CROP_EDITOR_CANVAS_SIZE = 460;
const MAP_ZOOM_MIN = 0.4;
const MAP_ZOOM_MAX = 3;

type MapEditorProps = {
  map: GameMapDefinition;
  onSave: (map: Omit<GameMapDefinition, "updatedAt">) => Promise<void>;
  onClose: () => void;
};

function cloneMap(map: GameMapDefinition): GameMapDefinition {
  return {
    ...map,
    objects: map.objects.map((entry) => ({ ...entry })),
    layers: map.layers.map((layer) => ({
      ...layer,
      tiles: layer.tiles.map((row) => [...row])
    }))
  };
}

function criarLayerVazia(mapSize: number, id: string, name: string): MapLayerDefinition {
  return {
    id,
    name,
    visible: true,
    tiles: Array.from({ length: mapSize }, () => Array.from({ length: mapSize }, () => null))
  };
}

function criarId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${random}`;
}

function lerArquivoImagem(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo de imagem."));
    reader.readAsDataURL(file);
  });
}

function parseNullableInt(value: string, min: number, max: number): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const normalized = Math.round(parsed);
  return Math.min(max, Math.max(min, normalized));
}

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CropViewport = {
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
  scale: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeCropRect(rect: CropRect, imageWidth: number, imageHeight: number): CropRect {
  const maxWidth = Math.max(1, Math.floor(imageWidth));
  const maxHeight = Math.max(1, Math.floor(imageHeight));
  const x = clamp(Math.floor(rect.x), 0, maxWidth - 1);
  const y = clamp(Math.floor(rect.y), 0, maxHeight - 1);
  const width = clamp(Math.floor(rect.width), 1, maxWidth - x);
  const height = clamp(Math.floor(rect.height), 1, maxHeight - y);
  return { x, y, width, height };
}

function alignCropRectToGrid(rect: CropRect, cellSize: number, imageWidth: number, imageHeight: number): CropRect {
  const safeCellSize = Math.max(1, Math.round(cellSize));
  const startX = Math.floor(rect.x / safeCellSize) * safeCellSize;
  const startY = Math.floor(rect.y / safeCellSize) * safeCellSize;
  const endX = Math.ceil((rect.x + rect.width) / safeCellSize) * safeCellSize;
  const endY = Math.ceil((rect.y + rect.height) / safeCellSize) * safeCellSize;
  return normalizeCropRect({ x: startX, y: startY, width: endX - startX, height: endY - startY }, imageWidth, imageHeight);
}

function gerarDataUrlRecorte(image: HTMLImageElement, rect: CropRect): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function resolveMapImageUrl(source: string): string {
  if (!source) {
    return source;
  }
  if (source.startsWith("data:") || source.startsWith("http://") || source.startsWith("https://")) {
    return source;
  }
  if (source.startsWith("/")) {
    return `${API_URL}${source}`;
  }
  return `${API_URL}/${source}`;
}

export default function MapEditor({ map, onSave, onClose }: MapEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const drawingRef = useRef(false);
  const drawingEraseRef = useRef(false);
  const lastTileRef = useRef<string | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cropImageRef = useRef<HTMLImageElement | null>(null);
  const cropViewportRef = useRef<CropViewport | null>(null);
  const cropDraggingRef = useRef(false);
  const cropDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const panningRef = useRef(false);
  const panStartRef = useRef<{ startX: number; startY: number; originPanX: number; originPanY: number } | null>(null);

  const [draft, setDraft] = useState<GameMapDefinition>(() => cloneMap(map));
  const [activeLayerId, setActiveLayerId] = useState<string>(map.layers[0]?.id ?? "");
  const [activeObjectId, setActiveObjectId] = useState<string>(map.objects[0]?.id ?? "");
  const [activeEnemySpawnId, setActiveEnemySpawnId] = useState<string>(map.enemySpawns?.[0]?.id ?? "");
  const [editorTab, setEditorTab] = useState<"layers" | "objects" | "enemies">("layers");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>("");

  const [newObjectName, setNewObjectName] = useState("Novo objeto");
  const [newObjectMaskWidth, setNewObjectMaskWidth] = useState(1);
  const [newObjectMaskHeight, setNewObjectMaskHeight] = useState(1);
  const [newObjectSolid, setNewObjectSolid] = useState(false);
  const [newObjectImageDataUrl, setNewObjectImageDataUrl] = useState("");
  const [cropEditorObjectId, setCropEditorObjectId] = useState<string | null>(null);
  const [cropSelection, setCropSelection] = useState<CropRect | null>(null);
  const [cropGridEnabled, setCropGridEnabled] = useState(false);
  const [cropGridCellSize, setCropGridCellSize] = useState(192);
  const [cropNewObjectName, setCropNewObjectName] = useState("");
  const [cropNewObjectMaskWidth, setCropNewObjectMaskWidth] = useState(1);
  const [cropNewObjectMaskHeight, setCropNewObjectMaskHeight] = useState(1);
  const [cropNewObjectSolid, setCropNewObjectSolid] = useState(false);

  // Estados para spawns de inimigos
  const [newEnemySpawnX, setNewEnemySpawnX] = useState(40);
  const [newEnemySpawnY, setNewEnemySpawnY] = useState(40);
  const [newEnemySpawnType, setNewEnemySpawnType] = useState<"WARRIOR" | "MONK">("WARRIOR");
  const [newEnemySpawnCount, setNewEnemySpawnCount] = useState(1);
  const [newEnemySpawnMixed, setNewEnemySpawnMixed] = useState(false);
  const [newEnemySpawnWarriorCount, setNewEnemySpawnWarriorCount] = useState(5);
  const [newEnemySpawnMonkCount, setNewEnemySpawnMonkCount] = useState(4);
  const [newEnemySpawnName, setNewEnemySpawnName] = useState("Spawn Inimigo");

  // Estados para zoom e pan (deslocamento)
  const [mapZoom, setMapZoom] = useState(1);
  const [mapPanX, setMapPanX] = useState(0);
  const [mapPanY, setMapPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [canvasViewportSize, setCanvasViewportSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    setDraft(cloneMap(map));
    setActiveLayerId(map.layers[0]?.id ?? "");
    setActiveObjectId(map.objects[0]?.id ?? "");
    setActiveEnemySpawnId(map.enemySpawns?.[0]?.id ?? "");
    setCropEditorObjectId(null);
    setCropSelection(null);
    setCropGridEnabled(false);
    setCropGridCellSize(192);
    setCropNewObjectName("");
    setCropNewObjectMaskWidth(1);
    setCropNewObjectMaskHeight(1);
    setCropNewObjectSolid(false);
    setMapZoom(1);
    setMapPanX(0);
    setMapPanY(0);
    setIsPanning(false);
    panningRef.current = false;
    panStartRef.current = null;
    setStatus("");
  }, [map]);

  useEffect(() => {
    if (draft.layers.some((layer) => layer.id === activeLayerId)) {
      return;
    }
    setActiveLayerId(draft.layers[0]?.id ?? "");
  }, [activeLayerId, draft.layers]);

  useEffect(() => {
    if (draft.objects.some((object) => object.id === activeObjectId)) {
      return;
    }
    setActiveObjectId(draft.objects[0]?.id ?? "");
  }, [activeObjectId, draft.objects]);

  useEffect(() => {
    if (draft.enemySpawns?.some((spawn) => spawn.id === activeEnemySpawnId)) {
      return;
    }
    setActiveEnemySpawnId(draft.enemySpawns?.[0]?.id ?? "");
  }, [activeEnemySpawnId, draft.enemySpawns]);

  const activeLayerIndex = useMemo(
    () => draft.layers.findIndex((layer) => layer.id === activeLayerId),
    [activeLayerId, draft.layers]
  );
  const activeObject = useMemo(
    () => draft.objects.find((entry) => entry.id === activeObjectId) ?? null,
    [activeObjectId, draft.objects]
  );
  const activeEnemySpawn = useMemo(
    () => draft.enemySpawns?.find((spawn) => spawn.id === activeEnemySpawnId) ?? null,
    [activeEnemySpawnId, draft.enemySpawns]
  );
  const cropEditorObject = useMemo(
    () => draft.objects.find((entry) => entry.id === cropEditorObjectId) ?? null,
    [cropEditorObjectId, draft.objects]
  );

  function clampPanForZoom(nextZoom: number, nextPanX: number, nextPanY: number): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: nextPanX, y: nextPanY };
    }
    const baseMapPixels = draft.mapSize * EDITOR_TILE_SIZE;
    const visibleWidth = Math.max(1, canvas.width || Math.floor(canvas.clientWidth));
    const visibleHeight = Math.max(1, canvas.height || Math.floor(canvas.clientHeight));
    const worldWidth = baseMapPixels * nextZoom;
    const worldHeight = baseMapPixels * nextZoom;

    let minX = visibleWidth - worldWidth;
    let maxX = 0;
    let minY = visibleHeight - worldHeight;
    let maxY = 0;

    if (worldWidth <= visibleWidth) {
      const centeredX = (visibleWidth - worldWidth) / 2;
      minX = centeredX;
      maxX = centeredX;
    }
    if (worldHeight <= visibleHeight) {
      const centeredY = (visibleHeight - worldHeight) / 2;
      minY = centeredY;
      maxY = centeredY;
    }

    return {
      x: clamp(nextPanX, minX, maxX),
      y: clamp(nextPanY, minY, maxY)
    };
  }

  function applyClampedView(nextZoom: number, nextPanX: number, nextPanY: number): void {
    const clamped = clampPanForZoom(nextZoom, nextPanX, nextPanY);
    setMapZoom(nextZoom);
    setMapPanX(clamped.x);
    setMapPanY(clamped.y);
  }

  function zoomAroundViewportCenter(nextZoom: number): void {
    const canvas = canvasRef.current;
    if (!canvas) {
      applyClampedView(nextZoom, mapPanX, mapPanY);
      return;
    }
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const worldX = (centerX - mapPanX) / mapZoom;
    const worldY = (centerY - mapPanY) / mapZoom;
    applyClampedView(nextZoom, centerX - worldX * nextZoom, centerY - worldY * nextZoom);
  }

  function updateObjectById(objectId: string, mutator: (object: MapObjectDefinition) => void): void {
    setDraft((current) => {
      const index = current.objects.findIndex((entry) => entry.id === objectId);
      if (index < 0) {
        return current;
      }
      const next = cloneMap(current);
      mutator(next.objects[index]);
      return next;
    });
  }

  function updateActiveObject(mutator: (object: MapObjectDefinition) => void): void {
    if (!activeObjectId) {
      return;
    }
    updateObjectById(activeObjectId, mutator);
  }

  function abrirEditorRecorte(objectId: string): void {
    const object = draft.objects.find((entry) => entry.id === objectId);
    if (!object) {
      return;
    }
    setActiveObjectId(objectId);
    setCropEditorObjectId(objectId);
    setCropSelection(null);
    setCropGridEnabled(false);
    setCropGridCellSize(192);
    setCropNewObjectName(`${object.name} recorte`);
    setCropNewObjectMaskWidth(object.maskWidth);
    setCropNewObjectMaskHeight(object.maskHeight);
    setCropNewObjectSolid(object.solid);
    cropDraggingRef.current = false;
    cropDragStartRef.current = null;
  }

  function fecharEditorRecorte(): void {
    setCropEditorObjectId(null);
    setCropSelection(null);
    cropDraggingRef.current = false;
    cropDragStartRef.current = null;
    cropImageRef.current = null;
    cropViewportRef.current = null;
  }

  function obterRecorteAtual(image: HTMLImageElement): CropRect {
    const fallback = { x: 0, y: 0, width: image.width, height: image.height };
    const normalized = normalizeCropRect(cropSelection ?? fallback, image.width, image.height);
    if (!cropGridEnabled) {
      return normalized;
    }
    return alignCropRectToGrid(normalized, cropGridCellSize, image.width, image.height);
  }

  function obterPontoNoEditorCrop(event: MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null {
    const canvas = cropCanvasRef.current;
    const viewport = cropViewportRef.current;
    const image = cropImageRef.current;
    if (!canvas || !viewport || !image) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    const localX = (event.clientX - rect.left) * scaleX;
    const localY = (event.clientY - rect.top) * scaleY;
    const clampedX = clamp(localX, viewport.drawX, viewport.drawX + viewport.drawWidth);
    const clampedY = clamp(localY, viewport.drawY, viewport.drawY + viewport.drawHeight);
    const imageX = clamp(Math.floor((clampedX - viewport.drawX) / viewport.scale), 0, Math.max(0, image.width - 1));
    const imageY = clamp(Math.floor((clampedY - viewport.drawY) / viewport.scale), 0, Math.max(0, image.height - 1));
    return { x: imageX, y: imageY };
  }

  function handleCropMouseDown(event: MouseEvent<HTMLCanvasElement>): void {
    if (event.button !== 0) {
      return;
    }
    const point = obterPontoNoEditorCrop(event);
    if (!point) {
      return;
    }
    event.preventDefault();
    cropDraggingRef.current = true;
    cropDragStartRef.current = point;
    const image = cropImageRef.current;
    if (!image) {
      return;
    }
    const baseRect = normalizeCropRect({ x: point.x, y: point.y, width: 1, height: 1 }, image.width, image.height);
    if (cropGridEnabled) {
      setCropSelection(alignCropRectToGrid(baseRect, cropGridCellSize, image.width, image.height));
      return;
    }
    setCropSelection(baseRect);
  }

  function handleCropMouseMove(event: MouseEvent<HTMLCanvasElement>): void {
    if (!cropDraggingRef.current) {
      return;
    }
    const point = obterPontoNoEditorCrop(event);
    const start = cropDragStartRef.current;
    const image = cropImageRef.current;
    if (!point || !start || !image) {
      return;
    }

    // Arraste cria um retangulo em pixels da imagem original (nao no tamanho do canvas).
    const x = Math.min(start.x, point.x);
    const y = Math.min(start.y, point.y);
    const width = Math.abs(point.x - start.x) + 1;
    const height = Math.abs(point.y - start.y) + 1;
    const baseRect = normalizeCropRect({ x, y, width, height }, image.width, image.height);
    if (cropGridEnabled) {
      // Com grid ativa, o recorte "encaixa" nas celulas configuradas.
      setCropSelection(alignCropRectToGrid(baseRect, cropGridCellSize, image.width, image.height));
      return;
    }
    setCropSelection(baseRect);
  }

  function handleCropMouseUp(): void {
    cropDraggingRef.current = false;
    cropDragStartRef.current = null;
  }

  function selecionarImagemInteiraNoRecorte(): void {
    const image = cropImageRef.current;
    if (image) {
      setCropSelection({ x: 0, y: 0, width: image.width, height: image.height });
    } else {
      setCropSelection(null);
    }
  }

  async function salvarRecorteNoObjetoAtual(): Promise<void> {
    if (!cropEditorObject) {
      return;
    }
    const image = cropImageRef.current;
    if (!image) {
      return;
    }
    const nextCrop = obterRecorteAtual(image);
    const dataUrl = gerarDataUrlRecorte(image, nextCrop);
    if (!dataUrl) {
      setStatus("Falha ao gerar imagem recortada. Verifique se a imagem foi carregada do servidor com CORS.");
      return;
    }

    try {
      const url = await uploadMapImage(`${cropEditorObject.name}-crop.png`, dataUrl);
      const objectName = cropEditorObject.name;
      updateObjectById(cropEditorObject.id, (object) => {
        object.imageDataUrl = url;
        object.cropX = null;
        object.cropY = null;
        object.cropWidth = null;
        object.cropHeight = null;
      });
      imageCacheRef.current.delete(cropEditorObject.id);
      setStatus(`Imagem de "${objectName}" sobrescrita com o recorte.`);
      fecharEditorRecorte();
    } catch {
      setStatus("Falha ao salvar recorte no servidor.");
    }
  }

  async function salvarRecorteComoNovoObjeto(): Promise<void> {
    if (!cropEditorObject) {
      return;
    }
    const image = cropImageRef.current;
    if (!image) {
      return;
    }

    const name = cropNewObjectName.trim();
    if (!name) {
      setStatus("Nome do novo objeto e obrigatorio para salvar o recorte.");
      return;
    }

    const nextCrop = obterRecorteAtual(image);
    const dataUrl = gerarDataUrlRecorte(image, nextCrop);
    if (!dataUrl) {
      setStatus("Falha ao gerar imagem recortada. Verifique se a imagem foi carregada do servidor com CORS.");
      return;
    }

    try {
      const imageUrl = await uploadMapImage(`${name}.png`, dataUrl);
      const object: MapObjectDefinition = {
        id: criarId("obj"),
        name,
        imageDataUrl: imageUrl,
        maskWidth: Math.max(1, Math.min(8, Math.round(cropNewObjectMaskWidth || 1))),
        maskHeight: Math.max(1, Math.min(8, Math.round(cropNewObjectMaskHeight || 1))),
        solid: cropNewObjectSolid,
        cropX: null,
        cropY: null,
        cropWidth: null,
        cropHeight: null
      };

      setDraft((current) => ({
        ...current,
        objects: [...current.objects, object]
      }));
      setActiveObjectId(object.id);
      setStatus(`Novo objeto "${object.name}" criado a partir do recorte.`);
      fecharEditorRecorte();
    } catch {
      setStatus("Falha ao salvar novo objeto recortado no servidor.");
    }
  }

  function paintAt(tileX: number, tileY: number, erase: boolean): void {
    const mapSize = draft.mapSize;
    if (tileX < 0 || tileY < 0 || tileX >= mapSize || tileY >= mapSize) {
      return;
    }

    setDraft((current) => {
      const layerIndex = current.layers.findIndex((layer) => layer.id === activeLayerId);
      if (layerIndex < 0) {
        return current;
      }

      const next = cloneMap(current);
      const layer = next.layers[layerIndex];

      if (erase || !activeObject) {
        layer.tiles[tileY][tileX] = null;
        return next;
      }

      // Tecnico: O brush ancora em 1 slot, mas aplica a mascara do objeto (w/h) na grid.
      // Crianca: Pinta um quadradinho de cada vez, ocupando o tamanhinho do objeto.
      for (let dy = 0; dy < activeObject.maskHeight; dy += 1) {
        const y = tileY + dy;
        if (y < 0 || y >= mapSize) {
          continue;
        }
        for (let dx = 0; dx < activeObject.maskWidth; dx += 1) {
          const x = tileX + dx;
          if (x < 0 || x >= mapSize) {
            continue;
          }
          layer.tiles[y][x] = activeObject.id;
        }
      }

      return next;
    });
  }

  function preencherLayerAtivaComObjetoSelecionado(): void {
    if (!activeObject) {
      setStatus("Selecione um objeto para preencher a grid.");
      return;
    }

    setDraft((current) => {
      const layerIndex = current.layers.findIndex((layer) => layer.id === activeLayerId);
      if (layerIndex < 0) {
        return current;
      }

      const next = cloneMap(current);
      const layer = next.layers[layerIndex];
      for (let y = 0; y < next.mapSize; y += 1) {
        for (let x = 0; x < next.mapSize; x += 1) {
          layer.tiles[y][x] = activeObject.id;
        }
      }
      return next;
    });

    const layerName = activeLayerIndex >= 0 ? draft.layers[activeLayerIndex].name : "layer ativa";
    setStatus(`Layer "${layerName}" preenchida com "${activeObject.name}".`);
  }

  function obterTileDoMouse(event: MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    // offsetX/offsetY são relativos ao elemento, considerando scroll
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;
    
    // Aplicar transformação inversa de zoom e pan
    const worldX = (canvasX - mapPanX) / mapZoom;
    const worldY = (canvasY - mapPanY) / mapZoom;
    
    const x = Math.floor(worldX / EDITOR_TILE_SIZE);
    const y = Math.floor(worldY / EDITOR_TILE_SIZE);
    if (x < 0 || y < 0 || x >= draft.mapSize || y >= draft.mapSize) {
      return null;
    }
    return { x, y };
  }

  function handleMouseDown(event: MouseEvent<HTMLCanvasElement>): void {
    if (event.button === 2) {
      event.preventDefault();
      panningRef.current = true;
      setIsPanning(true);
      panStartRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originPanX: mapPanX,
        originPanY: mapPanY
      };
      return;
    }
    if (event.button !== 0) {
      return;
    }
    const tile = obterTileDoMouse(event);
    if (!tile) {
      return;
    }

    // se estivermos na aba de inimigos, tratamos o clique como posicionamento/remoção de spawn
    if (editorTab === "enemies") {
      if (event.altKey) {
        // Alt+clique remove spawn na posicao, se existir
        setDraft((current) => {
          if (!current.enemySpawns) return current;
          const nextSpawns = current.enemySpawns.filter((s) => !(s.x === tile.x && s.y === tile.y));
          return { ...current, enemySpawns: nextSpawns };
        });
        return;
      }

      // botao esquerdo: se existe spawn ativo, mover; senão cria novo
      if (activeEnemySpawnId) {
        updateEnemySpawn(activeEnemySpawnId, (s) => {
          s.x = tile.x;
          s.y = tile.y;
        });
      } else {
        // cria novo spawn diretamente
        const count = (draft.enemySpawns?.length ?? 0) + 1;
        const newSpawn: EnemySpawnDefinition = {
          id: criarId("spawn"),
          name: `Spawn Inimigo ${count}`,
          x: tile.x,
          y: tile.y,
          enemyType: "WARRIOR",
          spawnCount: 1
        };
        setDraft((current) => ({
          ...current,
          enemySpawns: [...(current.enemySpawns || []), newSpawn]
        }));
        setActiveEnemySpawnId(newSpawn.id);
      }

      return;
    }

    // comportamento padrão de pintura
    const erase = event.altKey;
    drawingRef.current = true;
    drawingEraseRef.current = erase;
    lastTileRef.current = `${tile.x}:${tile.y}:${erase ? "erase" : "paint"}`;
    paintAt(tile.x, tile.y, erase);
  }

  function handleMouseMove(event: MouseEvent<HTMLCanvasElement>): void {
    if (panningRef.current && panStartRef.current) {
      const deltaX = event.clientX - panStartRef.current.startX;
      const deltaY = event.clientY - panStartRef.current.startY;
      const nextPan = clampPanForZoom(mapZoom, panStartRef.current.originPanX + deltaX, panStartRef.current.originPanY + deltaY);
      setMapPanX(nextPan.x);
      setMapPanY(nextPan.y);
      return;
    }
    // arrastar a partir de clique já registrado
    if (!drawingRef.current) {
      return;
    }
    const tile = obterTileDoMouse(event);
    if (!tile) {
      return;
    }

    if (editorTab === "enemies") {
      // enquanto arrastamos com botão esquerdo, movemos spawn ativo
      if (activeEnemySpawnId && !drawingEraseRef.current) {
        updateEnemySpawn(activeEnemySpawnId, (s) => {
          s.x = tile.x;
          s.y = tile.y;
        });
      }
      return;
    }

    const erase = drawingEraseRef.current;
    const key = `${tile.x}:${tile.y}:${erase ? "erase" : "paint"}`;
    if (lastTileRef.current === key) {
      return;
    }
    lastTileRef.current = key;
    paintAt(tile.x, tile.y, erase);
  }

  function handleMouseUp(): void {
    drawingRef.current = false;
    drawingEraseRef.current = false;
    lastTileRef.current = null;
    panningRef.current = false;
    panStartRef.current = null;
    setIsPanning(false);
  }

  function handleCanvasWheel(event: WheelEvent): void {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    event.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;

    const worldX = (canvasX - mapPanX) / mapZoom;
    const worldY = (canvasY - mapPanY) / mapZoom;
    const zoomFactor = event.deltaY < 0 ? 1.12 : 0.88;
    const nextZoom = clamp(Number((mapZoom * zoomFactor).toFixed(4)), MAP_ZOOM_MIN, MAP_ZOOM_MAX);
    applyClampedView(nextZoom, canvasX - worldX * nextZoom, canvasY - worldY * nextZoom);
  }

  useEffect(() => {
    const handleUp = () => {
      drawingRef.current = false;
      drawingEraseRef.current = false;
      lastTileRef.current = null;
      cropDraggingRef.current = false;
      cropDragStartRef.current = null;
      panningRef.current = false;
      panStartRef.current = null;
      setIsPanning(false);
    };
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("blur", handleUp);
    return () => {
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("blur", handleUp);
    };
  }, []);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      const tagName = target.tagName.toUpperCase();
      return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target.isContentEditable;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }

      const panStep = event.shiftKey ? 120 : 60;
      let nextZoom = mapZoom;
      let nextPanX = mapPanX;
      let nextPanY = mapPanY;
      let handled = true;

      switch (event.code) {
        case "ArrowLeft":
        case "KeyA":
          nextPanX += panStep;
          break;
        case "ArrowRight":
        case "KeyD":
          nextPanX -= panStep;
          break;
        case "ArrowUp":
        case "KeyW":
          nextPanY += panStep;
          break;
        case "ArrowDown":
        case "KeyS":
          nextPanY -= panStep;
          break;
        case "Equal":
        case "NumpadAdd":
          nextZoom = clamp(mapZoom * 1.12, MAP_ZOOM_MIN, MAP_ZOOM_MAX);
          break;
        case "Minus":
        case "NumpadSubtract":
          nextZoom = clamp(mapZoom * 0.88, MAP_ZOOM_MIN, MAP_ZOOM_MAX);
          break;
        default:
          handled = false;
      }

      if (!handled) {
        return;
      }
      event.preventDefault();

      applyClampedView(nextZoom, nextPanX, nextPanY);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mapPanX, mapPanY, mapZoom, draft.mapSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const syncViewport = () => {
      const width = Math.max(1, Math.floor(canvas.clientWidth));
      const height = Math.max(1, Math.floor(canvas.clientHeight));
      setCanvasViewportSize((current) => {
        if (current.width === width && current.height === height) {
          return current;
        }
        return { width, height };
      });
    };
    syncViewport();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncViewport);
      return () => {
        window.removeEventListener("resize", syncViewport);
      };
    }
    const observer = new ResizeObserver(syncViewport);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const clamped = clampPanForZoom(mapZoom, mapPanX, mapPanY);
    if (Math.abs(clamped.x - mapPanX) > 0.1 || Math.abs(clamped.y - mapPanY) > 0.1) {
      setMapPanX(clamped.x);
      setMapPanY(clamped.y);
    }
  }, [draft.mapSize, mapPanX, mapPanY, mapZoom, canvasViewportSize.width, canvasViewportSize.height]);

  useEffect(() => {
    if (!cropEditorObject) {
      cropImageRef.current = null;
      cropViewportRef.current = null;
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) {
        return;
      }
      cropImageRef.current = image;
      const hasStoredCrop =
        cropEditorObject.cropWidth !== null &&
        cropEditorObject.cropHeight !== null &&
        cropEditorObject.cropWidth > 0 &&
        cropEditorObject.cropHeight > 0;
      if (hasStoredCrop) {
        setCropSelection(
          normalizeCropRect(
            {
              x: cropEditorObject.cropX ?? 0,
              y: cropEditorObject.cropY ?? 0,
              width: cropEditorObject.cropWidth ?? image.width,
              height: cropEditorObject.cropHeight ?? image.height
            },
            image.width,
            image.height
          )
        );
      } else {
        setCropSelection({ x: 0, y: 0, width: image.width, height: image.height });
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setStatus("Falha ao abrir imagem no editor de recorte.");
      }
    };
    image.src = resolveMapImageUrl(cropEditorObject.imageDataUrl);

    return () => {
      cancelled = true;
    };
  }, [cropEditorObject]);

  useEffect(() => {
    const canvas = cropCanvasRef.current;
    const image = cropImageRef.current;
    if (!canvas || !image || !cropEditorObject) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    canvas.width = CROP_EDITOR_CANVAS_SIZE;
    canvas.height = CROP_EDITOR_CANVAS_SIZE;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#09101a";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const padding = 18;
    const maxDrawWidth = canvas.width - padding * 2;
    const maxDrawHeight = canvas.height - padding * 2;
    const baseScale = Math.min(maxDrawWidth / Math.max(1, image.width), maxDrawHeight / Math.max(1, image.height));
    const scale = Math.max(0.01, baseScale);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const drawX = (canvas.width - drawWidth) / 2;
    const drawY = (canvas.height - drawHeight) / 2;

    cropViewportRef.current = { drawX, drawY, drawWidth, drawHeight, scale };

    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    context.strokeStyle = "rgba(130, 180, 242, 0.45)";
    context.lineWidth = 1;
    context.strokeRect(drawX, drawY, drawWidth, drawHeight);

    const drawGridLines = (): void => {
      if (!cropGridEnabled) {
        return;
      }
      const safeCellSize = Math.max(1, Math.round(cropGridCellSize));
      context.strokeStyle = "rgba(103, 186, 255, 0.36)";
      context.lineWidth = 1;
      for (let x = safeCellSize; x < image.width; x += safeCellSize) {
        const px = drawX + x * scale;
        context.beginPath();
        context.moveTo(px, drawY);
        context.lineTo(px, drawY + drawHeight);
        context.stroke();
      }
      for (let y = safeCellSize; y < image.height; y += safeCellSize) {
        const py = drawY + y * scale;
        context.beginPath();
        context.moveTo(drawX, py);
        context.lineTo(drawX + drawWidth, py);
        context.stroke();
      }
    };

    if (cropSelection) {
      const selection = obterRecorteAtual(image);
      const selectionCanvasX = drawX + selection.x * scale;
      const selectionCanvasY = drawY + selection.y * scale;
      const selectionCanvasWidth = selection.width * scale;
      const selectionCanvasHeight = selection.height * scale;

      context.fillStyle = "rgba(6, 10, 14, 0.62)";
      context.fillRect(drawX, drawY, drawWidth, drawHeight);
      context.drawImage(
        image,
        selection.x,
        selection.y,
        selection.width,
        selection.height,
        selectionCanvasX,
        selectionCanvasY,
        selectionCanvasWidth,
        selectionCanvasHeight
      );
      context.strokeStyle = "rgba(117, 242, 157, 0.95)";
      context.lineWidth = 2;
      context.strokeRect(selectionCanvasX, selectionCanvasY, selectionCanvasWidth, selectionCanvasHeight);
    }

    drawGridLines();
  }, [cropEditorObject, cropSelection, cropGridEnabled, cropGridCellSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const viewportWidth = Math.max(1, canvasViewportSize.width || Math.floor(canvas.clientWidth));
    const viewportHeight = Math.max(1, canvasViewportSize.height || Math.floor(canvas.clientHeight));
    if (canvas.width !== viewportWidth) {
      canvas.width = viewportWidth;
    }
    if (canvas.height !== viewportHeight) {
      canvas.height = viewportHeight;
    }
    const mapPixels = draft.mapSize * EDITOR_TILE_SIZE;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#0f1721";
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Aplicar transformações de zoom e pan
    context.save();
    context.translate(mapPanX, mapPanY);
    context.scale(mapZoom, mapZoom);

    const objectById = new Map<string, MapObjectDefinition>(draft.objects.map((entry) => [entry.id, entry]));

    for (const layer of draft.layers) {
      if (!layer.visible) {
        continue;
      }
      for (let y = 0; y < draft.mapSize; y += 1) {
        for (let x = 0; x < draft.mapSize; x += 1) {
          const objectId = layer.tiles[y]?.[x] ?? null;
          if (!objectId) {
            continue;
          }
          const object = objectById.get(objectId);
          if (!object) {
            continue;
          }

          let image = imageCacheRef.current.get(object.id);
          if (!image) {
            image = new Image();
            image.crossOrigin = "anonymous";
            image.src = resolveMapImageUrl(object.imageDataUrl);
            imageCacheRef.current.set(object.id, image);
          }

          const drawX = x * EDITOR_TILE_SIZE;
          const drawY = y * EDITOR_TILE_SIZE;
          if (image.complete) {
            if (
              object.cropWidth !== null &&
              object.cropHeight !== null &&
              object.cropWidth > 0 &&
              object.cropHeight > 0
            ) {
              context.drawImage(
                image,
                object.cropX ?? 0,
                object.cropY ?? 0,
                object.cropWidth,
                object.cropHeight,
                drawX,
                drawY,
                EDITOR_TILE_SIZE,
                EDITOR_TILE_SIZE
              );
            } else {
              context.drawImage(image, drawX, drawY, EDITOR_TILE_SIZE, EDITOR_TILE_SIZE);
            }
          } else {
            context.fillStyle = object.solid ? "rgba(240, 106, 106, 0.8)" : "rgba(98, 199, 255, 0.8)";
            context.fillRect(drawX, drawY, EDITOR_TILE_SIZE, EDITOR_TILE_SIZE);
          }
        }
      }
    }

    context.strokeStyle = "rgba(183, 210, 238, 0.22)";
    context.lineWidth = 1;
    for (let x = 0; x <= draft.mapSize; x += 1) {
      context.beginPath();
      context.moveTo(x * EDITOR_TILE_SIZE, 0);
      context.lineTo(x * EDITOR_TILE_SIZE, mapPixels);
      context.stroke();
    }
    for (let y = 0; y <= draft.mapSize; y += 1) {
      context.beginPath();
      context.moveTo(0, y * EDITOR_TILE_SIZE);
      context.lineTo(mapPixels, y * EDITOR_TILE_SIZE);
      context.stroke();
    }

    // Se houver spawns de inimigos, marca-los
    if (draft.enemySpawns) {
      for (const spawn of draft.enemySpawns) {
        const cx = spawn.x * EDITOR_TILE_SIZE + EDITOR_TILE_SIZE / 2;
        const cy = spawn.y * EDITOR_TILE_SIZE + EDITOR_TILE_SIZE / 2;
        context.fillStyle = "rgba(255, 80, 80, 0.6)";
        context.beginPath();
        context.arc(cx, cy, EDITOR_TILE_SIZE * 0.4, 0, Math.PI * 2);
        context.fill();
        // destaque spawn ativo
        if (spawn.id === activeEnemySpawnId) {
          context.strokeStyle = "rgba(255, 80, 80, 1)";
          context.lineWidth = 2;
          context.beginPath();
          context.arc(cx, cy, EDITOR_TILE_SIZE * 0.45, 0, Math.PI * 2);
          context.stroke();
        }
      }
    }

    // Desenhar círculo de spawn de jogadores no centro
    context.strokeStyle = "rgba(100, 180, 255, 0.6)";
    context.lineWidth = 3;
    const spawnX = 40 * EDITOR_TILE_SIZE + EDITOR_TILE_SIZE / 2;
    const spawnY = 40 * EDITOR_TILE_SIZE + EDITOR_TILE_SIZE / 2;
    const spawnRadius = 2.5 * EDITOR_TILE_SIZE; // Raio visual
    context.beginPath();
    context.arc(spawnX, spawnY, spawnRadius, 0, Math.PI * 2);
    context.stroke();

    // Desenhar ponto central do spawn
    context.fillStyle = "rgba(100, 180, 255, 0.8)";
    context.beginPath();
    context.arc(spawnX, spawnY, 6, 0, Math.PI * 2);
    context.fill();

    context.restore();
  }, [draft, mapZoom, mapPanX, mapPanY, activeEnemySpawnId, canvasViewportSize.width, canvasViewportSize.height]);

  function addLayer(): void {
    const id = criarId("layer");
    setDraft((current) => ({
      ...current,
      layers: [...current.layers, criarLayerVazia(current.mapSize, id, `Layer ${current.layers.length + 1}`)]
    }));
    setActiveLayerId(id);
  }

  function removeLayer(layerId: string): void {
    setDraft((current) => {
      if (current.layers.length <= 1) {
        return current;
      }
      const nextLayers = current.layers.filter((entry) => entry.id !== layerId);
      return {
        ...current,
        layers: nextLayers
      };
    });
  }

  function moveLayer(layerId: string, direction: "up" | "down"): void {
    setDraft((current) => {
      const index = current.layers.findIndex((entry) => entry.id === layerId);
      if (index < 0) {
        return current;
      }
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.layers.length) {
        return current;
      }
      const nextLayers = [...current.layers];
      const [item] = nextLayers.splice(index, 1);
      nextLayers.splice(targetIndex, 0, item);
      return {
        ...current,
        layers: nextLayers
      };
    });
  }

  function addObject(): void {
    if (!newObjectImageDataUrl.trim()) {
      setStatus("Selecione uma imagem para o objeto.");
      return;
    }

    const object: MapObjectDefinition = {
      id: criarId("obj"),
      name: newObjectName.trim() || `Objeto ${draft.objects.length + 1}`,
      imageDataUrl: newObjectImageDataUrl,
      maskWidth: Math.max(1, Math.min(8, Math.round(newObjectMaskWidth))),
      maskHeight: Math.max(1, Math.min(8, Math.round(newObjectMaskHeight))),
      solid: newObjectSolid,
      cropX: null,
      cropY: null,
      cropWidth: null,
      cropHeight: null
    };

    setDraft((current) => ({
      ...current,
      objects: [...current.objects, object]
    }));
    setActiveObjectId(object.id);
    setStatus(`Objeto "${object.name}" adicionado.`);
  }

  async function uploadMapImage(name: string, dataUrl: string): Promise<string> {
    const resp = await fetch(`${API_URL}/api/map/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, dataUrl })
    });
    if (!resp.ok) {
      throw new Error("upload falhou");
    }
    const json = (await resp.json()) as { url: string };
    if (!json.url) {
      throw new Error("resposta de upload invalida");
    }
    return json.url;
  }

  async function onSelectObjectImage(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const dataUrl = await lerArquivoImagem(file);
      const url = await uploadMapImage(file.name, dataUrl);
      setNewObjectImageDataUrl(url);
      setStatus(`Imagem carregada: ${file.name}`);
    } catch (error) {
      console.error(error);
      setStatus("Falha ao carregar imagem.");
    }
  }

  async function onReplaceActiveObjectImage(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file || !activeObject) {
      return;
    }
    try {
      const dataUrl = await lerArquivoImagem(file);
      const url = await uploadMapImage(file.name, dataUrl);
      updateActiveObject((object) => {
        object.imageDataUrl = url;
      });
      setStatus(`Imagem do objeto "${activeObject.name}" atualizada.`);
    } catch (error) {
      console.error(error);
      setStatus("Falha ao trocar imagem do objeto.");
    }
  }

  function limparObjetoDoMapa(objectId: string): void {
    setDraft((current) => {
      const next = cloneMap(current);
      for (const layer of next.layers) {
        for (let y = 0; y < next.mapSize; y += 1) {
          for (let x = 0; x < next.mapSize; x += 1) {
            if (layer.tiles[y][x] === objectId) {
              layer.tiles[y][x] = null;
            }
          }
        }
      }
      return next;
    });
  }

  function limparObjetoSelecionadoDoMapa(): void {
    if (!activeObject) {
      return;
    }
    limparObjetoDoMapa(activeObject.id);
    setStatus(`Objeto "${activeObject.name}" limpo do cenario.`);
  }

  function removerObjetoSelecionado(): void {
    if (!activeObject) {
      return;
    }
    const removedId = activeObject.id;
    const removedName = activeObject.name;

    setDraft((current) => {
      const next = cloneMap(current);
      for (const layer of next.layers) {
        for (let y = 0; y < next.mapSize; y += 1) {
          for (let x = 0; x < next.mapSize; x += 1) {
            if (layer.tiles[y][x] === removedId) {
              layer.tiles[y][x] = null;
            }
          }
        }
      }
      next.objects = next.objects.filter((entry) => entry.id !== removedId);
      return next;
    });

    imageCacheRef.current.delete(removedId);
    setStatus(`Objeto "${removedName}" removido.`);
    setActiveObjectId((currentId) => (currentId === removedId ? "" : currentId));
  }

  // Funções de spawn de inimigos
  function addEnemySpawn(): void {
    if (!draft.enemySpawns) {
      draft.enemySpawns = [];
    }

    const newSpawn: import("../types").EnemySpawnDefinition = {
      id: criarId("spawn"),
      name: newEnemySpawnName.trim() || `Spawn Inimigo ${draft.enemySpawns.length + 1}`,
      x: Math.max(0, Math.min(79, newEnemySpawnX)),
      y: Math.max(0, Math.min(79, newEnemySpawnY)),
      enemyType: newEnemySpawnType,
      spawnCount: Math.max(
        1,
        Math.min(10, newEnemySpawnMixed ? newEnemySpawnWarriorCount + newEnemySpawnMonkCount : newEnemySpawnCount)
      ),
      warriorCount: newEnemySpawnMixed ? Math.max(0, Math.min(10, newEnemySpawnWarriorCount)) : undefined,
      monkCount: newEnemySpawnMixed ? Math.max(0, Math.min(10, newEnemySpawnMonkCount)) : undefined
    };

    setDraft((current) => ({
      ...current,
      enemySpawns: [...(current.enemySpawns || []), newSpawn]
    }));

    setActiveEnemySpawnId(newSpawn.id);
    setStatus(`Spawn de inimigo criado: ${newSpawn.name}`);
  }

  function removeEnemySpawn(spawnId: string): void {
    setDraft((current) => ({
      ...current,
      enemySpawns: (current.enemySpawns || []).filter((spawn) => spawn.id !== spawnId)
    }));
    setStatus("Spawn de inimigo removido.");
  }

  function updateEnemySpawn(spawnId: string, updater: (spawn: import("../types").EnemySpawnDefinition) => void): void {
    setDraft((current) => {
      const spawns = [...(current.enemySpawns || [])];
      const index = spawns.findIndex((s) => s.id === spawnId);
      if (index < 0) return current;
      updater(spawns[index]);
      return { ...current, enemySpawns: spawns };
    });
  }

  async function saveMap(): Promise<void> {
    setSaving(true);
    setStatus("Salvando mapa...");
    try {
      await onSave({
        mapKey: draft.mapKey.trim() || "default",
        name: draft.name.trim() || "Mapa Principal",
        mapSize: draft.mapSize,
        objects: draft.objects,
        layers: draft.layers,
        enemySpawns: draft.enemySpawns || []
      });
      setStatus("Mapa salvo no banco com sucesso.");
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "Falha ao salvar mapa.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="map-editor">
      <header className="map-editor-head">
        <div>
          <h3>Editor de Mapa</h3>
          <p>Clique esquerdo pinta, Alt + clique esquerdo apaga e botao direito arrasta o mapa.</p>
        </div>
        <div className="map-editor-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Fechar (/edit)
          </button>
          <button type="button" className="btn-primary" onClick={saveMap} disabled={saving}>
            {saving ? "Salvando..." : "Salvar no banco"}
          </button>
        </div>
      </header>

      <div className="map-editor-meta">
        <label>
          Map key
          <input value={draft.mapKey} onChange={(event) => setDraft((current) => ({ ...current, mapKey: event.target.value }))} />
        </label>
        <label>
          Nome do mapa
          <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
        </label>
      </div>
      <div className="map-editor-grid">
        <aside className="map-editor-sidebar">
          <div className="map-editor-tabs map-editor-tabs-side">
            <button className={`tab-button ${editorTab === "layers" ? "active" : ""}`} onClick={() => setEditorTab("layers")}>
              Layers
            </button>
            <button className={`tab-button ${editorTab === "objects" ? "active" : ""}`} onClick={() => setEditorTab("objects")}>
              Objetos
            </button>
            <button className={`tab-button ${editorTab === "enemies" ? "active" : ""}`} onClick={() => setEditorTab("enemies")}>
              Inimigos
            </button>
          </div>
          <section className={`map-editor-block ${editorTab === "layers" ? "" : "is-hidden"}`}>
            <div className="map-editor-block-head">
              <h4>Layers</h4>
              <button type="button" className="btn-ghost" onClick={addLayer}>
                + Layer
              </button>
            </div>
            <div className="map-editor-list">
              {draft.layers.map((layer, index) => (
                <article key={layer.id} className={`map-editor-layer ${layer.id === activeLayerId ? "active" : ""}`}>
                  <input
                    value={layer.name}
                    onChange={(event) =>
                      setDraft((current) => {
                        const next = cloneMap(current);
                        next.layers[index].name = event.target.value;
                        return next;
                      })
                    }
                  />
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={layer.visible}
                      onChange={(event) =>
                        setDraft((current) => {
                          const next = cloneMap(current);
                          next.layers[index].visible = event.target.checked;
                          return next;
                        })
                      }
                    />
                    visivel
                  </label>
                  <div className="map-editor-layer-actions">
                    <button type="button" className="btn-ghost" onClick={() => setActiveLayerId(layer.id)}>
                      editar
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => moveLayer(layer.id, "up")}>
                      ↑
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => moveLayer(layer.id, "down")}>
                      ↓
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => removeLayer(layer.id)}>
                      x
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={`map-editor-block ${editorTab === "objects" ? "" : "is-hidden"}`}>
            <h4>Novo objeto</h4>
            <label>
              Nome
              <input value={newObjectName} onChange={(event) => setNewObjectName(event.target.value)} />
            </label>
            <label>
              Mascara Largura (tiles)
              <input
                type="number"
                min={1}
                max={8}
                value={newObjectMaskWidth}
                onChange={(event) => setNewObjectMaskWidth(Number(event.target.value))}
              />
            </label>
            <label>
              Mascara Altura (tiles)
              <input
                type="number"
                min={1}
                max={8}
                value={newObjectMaskHeight}
                onChange={(event) => setNewObjectMaskHeight(Number(event.target.value))}
              />
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={newObjectSolid}
                onChange={(event) => setNewObjectSolid(event.target.checked)}
              />
              objeto solido (bloqueia player)
            </label>
            <label>
              Imagem
              <input type="file" accept="image/*" onChange={(event) => void onSelectObjectImage(event)} />
            </label>
            <button type="button" className="btn-primary" onClick={addObject}>
              Adicionar objeto
            </button>
          </section>

          <section className={`map-editor-block ${editorTab === "objects" ? "" : "is-hidden"}`}>
            <h4>Brushes</h4>
            <p className="empty-text">Duplo clique no brush para abrir o editor de recorte.</p>
            <div className="map-editor-objects">
              {draft.objects.map((object) => (
                <button
                  type="button"
                  key={object.id}
                  className={`map-editor-object ${object.id === activeObjectId ? "active" : ""}`}
                  onClick={() => setActiveObjectId(object.id)}
                  onDoubleClick={() => abrirEditorRecorte(object.id)}
                  title="Duplo clique para recortar imagem"
                >
                  <img src={resolveMapImageUrl(object.imageDataUrl)} alt={object.name} />
                  <strong>{object.name}</strong>
                  <small>
                    {object.maskWidth}x{object.maskHeight} {object.solid ? "solido" : "decor"}
                  </small>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-ghost"
              onClick={preencherLayerAtivaComObjetoSelecionado}
              disabled={!activeObject || activeLayerIndex < 0}
            >
              Preencher layer ativa
            </button>
          </section>

          <section className={`map-editor-block ${editorTab === "objects" ? "" : "is-hidden"}`}>
            <h4>Editar objeto selecionado</h4>
            {!activeObject ? <p className="empty-text">Selecione um brush para editar.</p> : null}
            {activeObject ? (
              <>
                <label>
                  Nome
                  <input
                    value={activeObject.name}
                    onChange={(event) =>
                      updateActiveObject((object) => {
                        object.name = event.target.value;
                      })
                    }
                  />
                </label>
                <label>
                  Mascara Largura
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={activeObject.maskWidth}
                    onChange={(event) =>
                      updateActiveObject((object) => {
                        object.maskWidth = Math.max(1, Math.min(8, Math.round(Number(event.target.value) || 1)));
                      })
                    }
                  />
                </label>
                <label>
                  Mascara Altura
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={activeObject.maskHeight}
                    onChange={(event) =>
                      updateActiveObject((object) => {
                        object.maskHeight = Math.max(1, Math.min(8, Math.round(Number(event.target.value) || 1)));
                      })
                    }
                  />
                </label>
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={activeObject.solid}
                    onChange={(event) =>
                      updateActiveObject((object) => {
                        object.solid = event.target.checked;
                      })
                    }
                  />
                  objeto solido
                </label>
                <label>
                  Trocar imagem
                  <input type="file" accept="image/*" onChange={(event) => void onReplaceActiveObjectImage(event)} />
                </label>

                <div className="map-editor-layer-actions">
                  <button type="button" className="btn-ghost" onClick={limparObjetoSelecionadoDoMapa}>
                    Limpar do mapa
                  </button>
                  <button type="button" className="btn-ghost" onClick={removerObjetoSelecionado}>
                    Remover objeto
                  </button>
                </div>

                <p className="empty-text">Recorte (tileset): deixe vazio para usar imagem inteira.</p>

                <button type="button" className="btn-ghost" onClick={() => abrirEditorRecorte(activeObject.id)}>
                  Abrir editor de recorte
                </button>

                <div className="map-editor-crop-grid">
                  <label>
                    Crop X
                    <input
                      type="number"
                      value={activeObject.cropX ?? ""}
                      onChange={(event) =>
                        updateActiveObject((object) => {
                          object.cropX = parseNullableInt(event.target.value, 0, 20_000);
                        })
                      }
                    />
                  </label>
                  <label>
                    Crop Y
                    <input
                      type="number"
                      value={activeObject.cropY ?? ""}
                      onChange={(event) =>
                        updateActiveObject((object) => {
                          object.cropY = parseNullableInt(event.target.value, 0, 20_000);
                        })
                      }
                    />
                  </label>
                  <label>
                    Crop Width
                    <input
                      type="number"
                      value={activeObject.cropWidth ?? ""}
                      onChange={(event) =>
                        updateActiveObject((object) => {
                          object.cropWidth = parseNullableInt(event.target.value, 1, 20_000);
                        })
                      }
                    />
                  </label>
                  <label>
                    Crop Height
                    <input
                      type="number"
                      value={activeObject.cropHeight ?? ""}
                      onChange={(event) =>
                        updateActiveObject((object) => {
                          object.cropHeight = parseNullableInt(event.target.value, 1, 20_000);
                        })
                      }
                    />
                  </label>
                </div>
              </>
            ) : null}
          </section>

          {editorTab === "enemies" && (
            <>
              <section className="map-editor-block">
                <div className="map-editor-block-head">
                  <h4>Spawns de Inimigos</h4>
                  <button type="button" className="btn-ghost" onClick={addEnemySpawn}>
                    + Spawn
                  </button>
                </div>
                <div className="map-editor-list">
                  {draft.enemySpawns &&
                    draft.enemySpawns.map((spawn) => {
                      const mixedTotal = (spawn.warriorCount ?? 0) + (spawn.monkCount ?? 0);
                      const mixLabel =
                        mixedTotal > 0
                          ? `Misto: ${spawn.warriorCount ?? 0}K / ${spawn.monkCount ?? 0}M`
                          : `Tipo: ${spawn.enemyType} | Qty: ${spawn.spawnCount}`;
                      return (
                        <article
                          key={spawn.id}
                          className={`map-editor-spawn ${spawn.id === activeEnemySpawnId ? "active" : ""}`}
                        >
                          <div>
                            <strong>{spawn.name}</strong>
                            <small>
                              Pos: ({spawn.x}, {spawn.y}) | {mixLabel}
                            </small>
                          </div>
                          <div className="map-editor-spawn-actions">
                            <button type="button" className="btn-ghost" onClick={() => setActiveEnemySpawnId(spawn.id)}>
                              editar
                            </button>
                            <button type="button" className="btn-ghost" onClick={() => removeEnemySpawn(spawn.id)}>
                              x
                            </button>
                          </div>
                        </article>
                      );
                    })}
                </div>
              </section>

              <section className="map-editor-block">
                <h4>Novo Spawn</h4>
                <label>
                  Nome
                  <input value={newEnemySpawnName} onChange={(event) => setNewEnemySpawnName(event.target.value)} />
                </label>
                <div className="map-editor-spawn-coords">
                  <label>
                    X
                    <input
                      type="number"
                      min={0}
                      max={79}
                      value={newEnemySpawnX}
                      onChange={(event) => setNewEnemySpawnX(Math.max(0, Math.min(79, Number(event.target.value))))}
                    />
                  </label>
                  <label>
                    Y
                    <input
                      type="number"
                      min={0}
                      max={79}
                      value={newEnemySpawnY}
                      onChange={(event) => setNewEnemySpawnY(Math.max(0, Math.min(79, Number(event.target.value))))}
                    />
                  </label>
                </div>
                  <label>
                    Tipo de Inimigo
                    <select value={newEnemySpawnType} onChange={(event) => setNewEnemySpawnType(event.target.value as "WARRIOR" | "MONK")}>
                      <option value="WARRIOR">Warrior</option>
                      <option value="MONK">Monk</option>
                    </select>
                  </label>
                  <label>
                    Quantidade de Inimigos
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={newEnemySpawnCount}
                      onChange={(event) => setNewEnemySpawnCount(Math.max(1, Math.min(10, Number(event.target.value))))}
                    />
                  </label>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={newEnemySpawnMixed}
                      onChange={(event) => setNewEnemySpawnMixed(event.target.checked)}
                    />
                    Spawn misto
                  </label>
                  {newEnemySpawnMixed ? (
                    <>
                      <label>
                        Knights
                        <input
                          type="number"
                          min={0}
                          max={10}
                          value={newEnemySpawnWarriorCount}
                          onChange={(event) =>
                            setNewEnemySpawnWarriorCount(Math.max(0, Math.min(10, Number(event.target.value))))
                          }
                        />
                      </label>
                      <label>
                        Monks
                        <input
                          type="number"
                          min={0}
                          max={10}
                          value={newEnemySpawnMonkCount}
                          onChange={(event) =>
                            setNewEnemySpawnMonkCount(Math.max(0, Math.min(10, Number(event.target.value))))
                          }
                        />
                      </label>
                    </>
                  ) : null}
                  <button type="button" className="btn-primary" onClick={addEnemySpawn}>
                    Adicionar Spawn
                  </button>
                </section>

              {activeEnemySpawn && (
                <section className="map-editor-block">
                  <h4>Editar Spawn: {activeEnemySpawn.name}</h4>
                  <label>
                    Nome
                    <input
                      value={activeEnemySpawn.name}
                      onChange={(event) =>
                        updateEnemySpawn(activeEnemySpawn.id, (spawn) => {
                          spawn.name = event.target.value;
                        })
                      }
                    />
                  </label>
                  <div className="map-editor-spawn-coords">
                    <label>
                      X
                      <input
                        type="number"
                        min={0}
                        max={79}
                        value={activeEnemySpawn.x}
                        onChange={(event) =>
                          updateEnemySpawn(activeEnemySpawn.id, (spawn) => {
                            spawn.x = Math.max(0, Math.min(79, Number(event.target.value)));
                          })
                        }
                      />
                    </label>
                    <label>
                      Y
                      <input
                        type="number"
                        min={0}
                        max={79}
                        value={activeEnemySpawn.y}
                        onChange={(event) =>
                          updateEnemySpawn(activeEnemySpawn.id, (spawn) => {
                            spawn.y = Math.max(0, Math.min(79, Number(event.target.value)));
                          })
                        }
                      />
                    </label>
                  </div>
                  <label>
                    Tipo de Inimigo
                    <select
                      value={activeEnemySpawn.enemyType}
                      onChange={(event) =>
                        updateEnemySpawn(activeEnemySpawn.id, (spawn) => {
                          spawn.enemyType = event.target.value as "WARRIOR" | "MONK";
                        })
                      }
                    >
                      <option value="WARRIOR">Warrior</option>
                      <option value="MONK">Monk</option>
                    </select>
                  </label>
                  <label>
                    Quantidade
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={activeEnemySpawn.spawnCount}
                      onChange={(event) =>
                        updateEnemySpawn(activeEnemySpawn.id, (spawn) => {
                          spawn.spawnCount = Math.max(1, Math.min(10, Number(event.target.value)));
                        })
                      }
                    />
                  </label>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={(activeEnemySpawn.warriorCount ?? 0) + (activeEnemySpawn.monkCount ?? 0) > 0}
                      onChange={(event) =>
                        updateEnemySpawn(activeEnemySpawn.id, (spawn) => {
                          if (event.target.checked) {
                            spawn.warriorCount = Math.max(0, Math.min(10, spawn.warriorCount ?? 5));
                            spawn.monkCount = Math.max(0, Math.min(10, spawn.monkCount ?? 4));
                            spawn.spawnCount = Math.max(
                              1,
                              Math.min(10, (spawn.warriorCount ?? 0) + (spawn.monkCount ?? 0))
                            );
                          } else {
                            spawn.warriorCount = undefined;
                            spawn.monkCount = undefined;
                          }
                        })
                      }
                    />
                    Spawn misto
                  </label>
                  {(activeEnemySpawn.warriorCount ?? 0) + (activeEnemySpawn.monkCount ?? 0) > 0 ? (
                    <>
                      <label>
                        Knights
                        <input
                          type="number"
                          min={0}
                          max={10}
                          value={activeEnemySpawn.warriorCount ?? 0}
                          onChange={(event) =>
                            updateEnemySpawn(activeEnemySpawn.id, (spawn) => {
                              spawn.warriorCount = Math.max(0, Math.min(10, Number(event.target.value)));
                              spawn.spawnCount = Math.max(
                                1,
                                Math.min(10, (spawn.warriorCount ?? 0) + (spawn.monkCount ?? 0))
                              );
                            })
                          }
                        />
                      </label>
                      <label>
                        Monks
                        <input
                          type="number"
                          min={0}
                          max={10}
                          value={activeEnemySpawn.monkCount ?? 0}
                          onChange={(event) =>
                            updateEnemySpawn(activeEnemySpawn.id, (spawn) => {
                              spawn.monkCount = Math.max(0, Math.min(10, Number(event.target.value)));
                              spawn.spawnCount = Math.max(
                                1,
                                Math.min(10, (spawn.warriorCount ?? 0) + (spawn.monkCount ?? 0))
                              );
                            })
                          }
                        />
                      </label>
                    </>
                  ) : null}
                </section>
              )}
            </>
          )}
        </aside>

        <div className="map-editor-canvas-shell">
          <div className="map-editor-zoom-controls">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => zoomAroundViewportCenter(clamp(mapZoom + 0.2, MAP_ZOOM_MIN, MAP_ZOOM_MAX))}
              title="Zoom in"
            >
              Zoom +
            </button>
            <span className="zoom-indicator">{Math.round(mapZoom * 100)}%</span>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => zoomAroundViewportCenter(clamp(mapZoom - 0.2, MAP_ZOOM_MIN, MAP_ZOOM_MAX))}
              title="Zoom out"
            >
              Zoom -
            </button>
            <input
              type="range"
              min={MAP_ZOOM_MIN * 100}
              max={MAP_ZOOM_MAX * 100}
              step={5}
              value={Math.round(mapZoom * 100)}
              onChange={(event) =>
                zoomAroundViewportCenter(clamp(Number(event.target.value) / 100, MAP_ZOOM_MIN, MAP_ZOOM_MAX))
              }
              aria-label="Zoom do mapa"
            />
            <button
              type="button"
              className="btn-ghost"
              onClick={() => applyClampedView(1, 0, 0)}
              title="Reset zoom"
            >
              Reset view
            </button>
            <span className="map-editor-nav-hint">Navegar: botao direito + arrastar | zoom na lupa ou roda do mouse</span>
          </div>
          <div className="map-editor-canvas-viewport">
            <canvas
              ref={canvasRef}
              className={`map-editor-canvas ${isPanning ? "panning" : ""}`}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={(event) => handleCanvasWheel(event.nativeEvent)}
              onContextMenu={(event) => event.preventDefault()}
            />
          </div>
        </div>
      </div>

      <footer className="map-editor-footer">
        <span>
          Layer ativo: <strong>{activeLayerIndex >= 0 ? draft.layers[activeLayerIndex].name : "-"}</strong>
        </span>
        <span>
          Brush: <strong>{activeObject?.name ?? "nenhum"}</strong>
        </span>
        <span>{status}</span>
      </footer>

      {cropEditorObject ? (
        <div
          className="map-editor-crop-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              fecharEditorRecorte();
            }
          }}
        >
          <section className="map-editor-crop-modal" role="dialog" aria-modal="true">
            <header>
              <h4>Recorte de imagem: {cropEditorObject.name}</h4>
              <p>Arraste o mouse na imagem para definir a mascara do objeto.</p>
            </header>

            <canvas
              ref={cropCanvasRef}
              className="map-editor-crop-canvas"
              onMouseDown={handleCropMouseDown}
              onMouseMove={handleCropMouseMove}
              onMouseUp={handleCropMouseUp}
              onMouseLeave={handleCropMouseUp}
            />

            <div className="map-editor-crop-tools">
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={cropGridEnabled}
                  onChange={(event) => setCropGridEnabled(event.target.checked)}
                />
                dividir em grid
              </label>
              <label>
                tamanho da celula (px)
                <input
                  type="number"
                  min={1}
                  value={cropGridCellSize}
                  onChange={(event) => setCropGridCellSize(Math.max(1, Math.round(Number(event.target.value) || 1)))}
                />
              </label>
            </div>

            <p className="empty-text">
              Selecao atual:{" "}
              {(() => {
                const image = cropImageRef.current;
                if (!image) {
                  return "-";
                }
                const selected = obterRecorteAtual(image);
                return `${selected.x}, ${selected.y} | ${selected.width}x${selected.height}`;
              })()}
            </p>

            <div className="map-editor-crop-new-object">
              <h5>Salvar como novo objeto</h5>
              <label>
                Nome do novo objeto *
                <input value={cropNewObjectName} onChange={(event) => setCropNewObjectName(event.target.value)} />
              </label>
              <div className="map-editor-crop-new-object-grid">
                <label>
                  Mascara Largura
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={cropNewObjectMaskWidth}
                    onChange={(event) => setCropNewObjectMaskWidth(Math.max(1, Math.round(Number(event.target.value) || 1)))}
                  />
                </label>
                <label>
                  Mascara Altura
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={cropNewObjectMaskHeight}
                    onChange={(event) => setCropNewObjectMaskHeight(Math.max(1, Math.round(Number(event.target.value) || 1)))}
                  />
                </label>
              </div>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={cropNewObjectSolid}
                  onChange={(event) => setCropNewObjectSolid(event.target.checked)}
                />
                objeto solido (colisao)
              </label>
            </div>

            <div className="map-editor-crop-modal-actions">
              <button type="button" className="btn-ghost" onClick={selecionarImagemInteiraNoRecorte}>
                Imagem inteira
              </button>
              <button type="button" className="btn-ghost" onClick={fecharEditorRecorte}>
                Cancelar
              </button>
              <button type="button" className="btn-primary" onClick={salvarRecorteNoObjetoAtual}>
                Salvar neste objeto
              </button>
              <button type="button" className="btn-primary" onClick={salvarRecorteComoNovoObjeto}>
                Salvar como novo objeto
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
