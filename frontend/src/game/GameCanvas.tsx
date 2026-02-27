import { useEffect, useMemo, useRef, useState } from "react";

import idleGif from "../../images/Warrior/idle.gif";
import runGif from "../../images/Warrior/run.gif";
import { setupInput } from "./input";
import type { Direction, WorldUpdatePayload } from "../types";

const TILE_SIZE = 56;
const PLAYER_INTERPOLATION_RATE = 16;
const CAMERA_INTERPOLATION_RATE = 12;

type CameraState = {
  x: number;
  y: number;
  initialized: boolean;
};

type RenderPlayer = {
  id: number;
  name: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  hp: number;
  maxHp: number;
  online: boolean;
  facing: "left" | "right";
  moving: boolean;
};

type OverlaySprite = {
  id: number;
  name: string;
  left: number;
  top: number;
  size: number;
  facing: "left" | "right";
  moving: boolean;
  self: boolean;
};

type GameCanvasProps = {
  world: WorldUpdatePayload | null;
  selfPlayerId: number | null;
  onMove: (direction: Direction | null) => void;
};

function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    return value;
  }
  return Math.min(max, Math.max(min, value));
}

function interpolationAlpha(ratePerSecond: number, deltaSeconds: number): number {
  return 1 - Math.exp(-ratePerSecond * deltaSeconds);
}

export default function GameCanvas({ world, selfPlayerId, onMove }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef<CameraState>({ x: 0, y: 0, initialized: false });
  const renderedPlayersRef = useRef<Map<number, RenderPlayer>>(new Map());
  const lastFrameAtRef = useRef<number | null>(null);
  const worldRef = useRef(world);
  const selfPlayerIdRef = useRef(selfPlayerId);
  const [overlaySprites, setOverlaySprites] = useState<OverlaySprite[]>([]);

  worldRef.current = world;
  selfPlayerIdRef.current = selfPlayerId;

  const hasWorld = useMemo(() => Boolean(world && world.players.length > 0), [world]);

  useEffect(() => {
    const cleanup = setupInput(onMove);
    return cleanup;
  }, [onMove]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let rafId = 0;
    let destroyed = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = Math.max(1, window.devicePixelRatio || 1);

      canvas.width = Math.floor(rect.width * pixelRatio);
      canvas.height = Math.floor(rect.height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const draw = () => {
      if (destroyed) {
        return;
      }

      const nowMs = performance.now();
      const previousFrameAt = lastFrameAtRef.current;
      lastFrameAtRef.current = nowMs;
      const deltaSeconds =
        previousFrameAt === null ? 1 / 60 : Math.min((nowMs - previousFrameAt) / 1000, 0.1);

      const currentWorld = worldRef.current;
      const currentSelfId = selfPlayerIdRef.current;
      const viewportWidth = canvas.clientWidth;
      const viewportHeight = canvas.clientHeight;

      context.clearRect(0, 0, viewportWidth, viewportHeight);
      context.fillStyle = "#0a1117";
      context.fillRect(0, 0, viewportWidth, viewportHeight);

      if (!currentWorld || !currentSelfId) {
        renderedPlayersRef.current.clear();
        setOverlaySprites([]);
        context.fillStyle = "#f3f6f8";
        context.font = "600 20px Rajdhani";
        context.fillText("Conectando no mundo...", 26, 44);
        rafId = window.requestAnimationFrame(draw);
        return;
      }

      const mapPixelSize = currentWorld.mapSize * TILE_SIZE;
      const alphaPlayer = interpolationAlpha(PLAYER_INTERPOLATION_RATE, deltaSeconds);
      const renderedPlayers = renderedPlayersRef.current;
      const targetIds = new Set<number>();

      for (const player of currentWorld.players) {
        targetIds.add(player.id);
        const existing = renderedPlayers.get(player.id);
        if (!existing) {
          renderedPlayers.set(player.id, {
            id: player.id,
            name: player.name,
            x: player.x,
            y: player.y,
            targetX: player.x,
            targetY: player.y,
            hp: player.hp,
            maxHp: player.maxHp,
            online: player.online,
            facing: "right",
            moving: false
          });
          continue;
        }

        existing.name = player.name;
        existing.hp = player.hp;
        existing.maxHp = player.maxHp;
        existing.online = player.online;
        existing.targetX = player.x;
        existing.targetY = player.y;
      }

      for (const player of renderedPlayers.values()) {
        const previousX = player.x;
        const previousY = player.y;

        player.x += (player.targetX - player.x) * alphaPlayer;
        player.y += (player.targetY - player.y) * alphaPlayer;

        const movedX = player.x - previousX;
        const movedY = player.y - previousY;

        if (movedX < -0.001) {
          player.facing = "left";
        } else if (movedX > 0.001) {
          player.facing = "right";
        }

        const remainingDistance = Math.hypot(player.targetX - player.x, player.targetY - player.y);
        const frameDistance = Math.hypot(movedX, movedY);
        player.moving = frameDistance > 0.001 || remainingDistance > 0.01;
      }

      for (const playerId of [...renderedPlayers.keys()]) {
        if (!targetIds.has(playerId)) {
          renderedPlayers.delete(playerId);
        }
      }

      const selfPlayer = renderedPlayers.get(currentSelfId) ?? null;

      if (!selfPlayer) {
        setOverlaySprites([]);
        context.fillStyle = "#f3f6f8";
        context.font = "600 20px Rajdhani";
        context.fillText("Aguardando seu personagem no snapshot...", 26, 44);
        rafId = window.requestAnimationFrame(draw);
        return;
      }

      const camera = cameraRef.current;
      const targetX = selfPlayer.x * TILE_SIZE + TILE_SIZE / 2;
      const targetY = selfPlayer.y * TILE_SIZE + TILE_SIZE / 2;
      const clampedTargetX = clamp(targetX, viewportWidth / 2, mapPixelSize - viewportWidth / 2);
      const clampedTargetY = clamp(targetY, viewportHeight / 2, mapPixelSize - viewportHeight / 2);

      if (!camera.initialized) {
        camera.x = clampedTargetX;
        camera.y = clampedTargetY;
        camera.initialized = true;
      } else {
        const alphaCamera = interpolationAlpha(CAMERA_INTERPOLATION_RATE, deltaSeconds);
        camera.x += (clampedTargetX - camera.x) * alphaCamera;
        camera.y += (clampedTargetY - camera.y) * alphaCamera;
      }

      camera.x = clamp(camera.x, viewportWidth / 2, mapPixelSize - viewportWidth / 2);
      camera.y = clamp(camera.y, viewportHeight / 2, mapPixelSize - viewportHeight / 2);

      const offsetX = viewportWidth / 2 - camera.x;
      const offsetY = viewportHeight / 2 - camera.y;
      const renderOffsetX = Math.round(offsetX);
      const renderOffsetY = Math.round(offsetY);

      const gradient = context.createLinearGradient(0, 0, viewportWidth, viewportHeight);
      gradient.addColorStop(0, "#152028");
      gradient.addColorStop(1, "#111a22");
      context.fillStyle = gradient;
      context.fillRect(renderOffsetX, renderOffsetY, mapPixelSize, mapPixelSize);

      context.strokeStyle = "rgba(186, 213, 228, 0.2)";
      context.lineWidth = 1;
      for (let x = 0; x <= currentWorld.mapSize; x += 1) {
        const sx = renderOffsetX + x * TILE_SIZE;
        context.beginPath();
        context.moveTo(sx, renderOffsetY);
        context.lineTo(sx, renderOffsetY + mapPixelSize);
        context.stroke();
      }

      for (let y = 0; y <= currentWorld.mapSize; y += 1) {
        const sy = renderOffsetY + y * TILE_SIZE;
        context.beginPath();
        context.moveTo(renderOffsetX, sy);
        context.lineTo(renderOffsetX + mapPixelSize, sy);
        context.stroke();
      }

      context.strokeStyle = "rgba(251, 210, 79, 0.65)";
      context.lineWidth = 2;
      context.strokeRect(renderOffsetX, renderOffsetY, mapPixelSize, mapPixelSize);

      const sprites: OverlaySprite[] = [];
      for (const player of renderedPlayers.values()) {
        const centerX = renderOffsetX + player.x * TILE_SIZE + TILE_SIZE / 2;
        const floorY = renderOffsetY + player.y * TILE_SIZE + TILE_SIZE - 2;
        const spriteSize = Math.round(TILE_SIZE * 1.4);
        const drawX = Math.round(centerX - spriteSize / 2);
        const drawY = Math.round(floorY - spriteSize);
        sprites.push({
          id: player.id,
          name: player.name,
          left: drawX,
          top: drawY,
          size: spriteSize,
          facing: player.facing,
          moving: player.moving,
          self: player.id === currentSelfId
        });
      }
      setOverlaySprites(sprites);

      context.fillStyle = "rgba(5, 10, 13, 0.66)";
      context.fillRect(12, 12, 250, 62);
      context.fillStyle = "#dce7ee";
      context.font = "600 16px Rajdhani";
      context.textAlign = "left";
      context.fillText(`Seu player: ${selfPlayer.name}`, 20, 36);
      context.fillText(`Pos: (${selfPlayer.x.toFixed(1)}, ${selfPlayer.y.toFixed(1)})`, 20, 58);

      rafId = window.requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);

    return () => {
      destroyed = true;
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="map-shell">
      <canvas ref={canvasRef} className="map-canvas" />
      <div className="sprite-layer" aria-hidden="true">
        {overlaySprites.map((sprite) => (
          <div
            key={sprite.id}
            className={`player-sprite ${sprite.self ? "self" : ""}`}
            style={{
              left: sprite.left,
              top: sprite.top,
              width: sprite.size,
              height: sprite.size
            }}
          >
            <img
              src={sprite.moving ? runGif : idleGif}
              alt=""
              className={`player-sprite-img ${sprite.facing === "left" ? "flip-left" : ""}`}
            />
            <span className="player-sprite-name">{sprite.name}</span>
          </div>
        ))}
      </div>
      {!hasWorld ? <p className="map-hint">Conectando ao loop do servidor...</p> : null}
    </div>
  );
}
