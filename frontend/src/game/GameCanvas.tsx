import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import monkAttack1Gif from "../../images/Monk/attack1.gif";
import monkAttack2Gif from "../../images/Monk/attack2.gif";
import monkHealEffectGif from "../../images/Monk/healEffect.gif";
import monkIdleGif from "../../images/Monk/idle.gif";
import monkRunGif from "../../images/Monk/run.gif";
import warriorAttack1Gif from "../../images/Warrior/attack1.gif";
import warriorAttack2Gif from "../../images/Warrior/attack2.gif";
import warriorHurtGif from "../../images/Warrior/hurt.gif";
import warriorIdleGif from "../../images/Warrior/idle.gif";
import warriorRunGif from "../../images/Warrior/run.gif";
import { setupInput } from "./input";
import { PlayerType, type GameMapDefinition, type MoveInput, type WorldUpdatePayload } from "../types";

const TILE_SIZE = 160;
const PLAYER_INTERPOLATION_RATE = 16;
const CAMERA_INTERPOLATION_RATE = 12;
const AIM_VECTOR_SENSITIVITY = 0.025;
const ATTACK_RANGE_TILES = 1;
const ATTACK_AIM_GAP_PX = 18;
const WARRIOR_ATTACK_VISUAL_MS = 400;
const MONK_HEAL_VISUAL_MS = 1100;
const MAP_TILE_OVERDRAW_PX = 1;

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
  playerType: PlayerType;
  facing: "left" | "right";
  moving: boolean;
  hurtUntilMs: number;
};

type OverlaySprite = {
  id: number;
  name: string;
  left: number;
  top: number;
  size: number;
  hp: number;
  maxHp: number;
  playerType: PlayerType;
  facing: "left" | "right";
  moving: boolean;
  hurt: boolean;
  attacking: boolean;
  attackPhaseTwo: boolean;
  self: boolean;
};

type OverlayHealEffect = {
  id: number;
  left: number;
  top: number;
  size: number;
};

type AttackAimInput = {
  dirX: number;
  dirY: number;
  range?: number;
};

type GameCanvasProps = {
  world: WorldUpdatePayload | null;
  mapDefinition?: GameMapDefinition | null;
  selfPlayerId: number | null;
  onMove: (input: MoveInput) => void;
  onAttack?: (input: AttackAimInput) => void;
  showGrid?: boolean;
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

function healthPercent(hp: number, maxHp: number): number {
  if (maxHp <= 0) {
    return 0;
  }
  const ratio = hp / maxHp;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

function normalizeDirection(
  x: number,
  y: number,
  fallback: { x: number; y: number } = { x: 1, y: 0 }
): { x: number; y: number } {
  const length = Math.hypot(x, y);
  if (length < 0.0001) {
    return fallback;
  }

  return {
    x: x / length,
    y: y / length
  };
}

function angleDegFromVector(x: number, y: number): number {
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function escolherSpriteGif(
  sprite: Pick<OverlaySprite, "playerType" | "moving" | "hurt" | "attacking" | "attackPhaseTwo">
): string {
  // Monk nao possui gif de hurt, entao reaproveitamos o idle no estado de dano.
  if (sprite.attacking) {
    if (sprite.playerType === PlayerType.MONK) {
      return sprite.attackPhaseTwo ? monkAttack2Gif : monkAttack1Gif;
    }
    return sprite.attackPhaseTwo ? warriorAttack2Gif : warriorAttack1Gif;
  }

  if (sprite.hurt) {
    return sprite.playerType === PlayerType.MONK ? monkIdleGif : warriorHurtGif;
  }

  if (sprite.moving) {
    return sprite.playerType === PlayerType.MONK ? monkRunGif : warriorRunGif;
  }

  return sprite.playerType === PlayerType.MONK ? monkIdleGif : warriorIdleGif;
}

export default function GameCanvas({ world, mapDefinition, selfPlayerId, onMove, onAttack, showGrid = false }: GameCanvasProps) {
  const mapShellRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef<CameraState>({ x: 0, y: 0, initialized: false });
  const renderedPlayersRef = useRef<Map<number, RenderPlayer>>(new Map());
  const lastFrameAtRef = useRef<number | null>(null);
  const worldRef = useRef(world);
  const mapDefinitionRef = useRef(mapDefinition ?? null);
  const selfPlayerIdRef = useRef(selfPlayerId);
  const onAttackRef = useRef(onAttack);
  const onMoveRef = useRef(onMove);
  const showGridRef = useRef(showGrid);
  const aimVectorRef = useRef<{ x: number; y: number }>({ x: 1, y: 0 });
  const mapImageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const attackAnimationByOwnerRef = useRef<
    Map<number, { attackId: number; kind: "damage" | "heal"; phaseTwo: boolean; endsAtMs: number }>
  >(new Map());
  const nextAttackPhaseTwoByOwnerRef = useRef<Map<number, boolean>>(new Map());

  const [overlaySprites, setOverlaySprites] = useState<OverlaySprite[]>([]);
  const [overlayHealEffects, setOverlayHealEffects] = useState<OverlayHealEffect[]>([]);
  const [aimLocked, setAimLocked] = useState(false);
  const [aimVector, setAimVector] = useState<{ x: number; y: number }>({ x: 1, y: 0 });

  // Sempre manter refs atualizadas sem re-registrar listeners
  worldRef.current = world;
  mapDefinitionRef.current = mapDefinition ?? null;
  selfPlayerIdRef.current = selfPlayerId;
  onAttackRef.current = onAttack;
  onMoveRef.current = onMove;
  showGridRef.current = showGrid;

  const hasWorld = useMemo(() => Boolean(world && world.players.length > 0), [world]);

  const selfPlayerOverlayInfo = useMemo(() => {
    if (!world || !selfPlayerId) {
      return null;
    }
    const player = world.players.find((entry) => entry.id === selfPlayerId);
    if (!player) {
      return null;
    }
    return { name: player.name, x: player.x, y: player.y };
  }, [selfPlayerId, world]);

  const selfSprite = useMemo(() => overlaySprites.find((sprite) => sprite.self) ?? null, [overlaySprites]);

  const aimArrow = useMemo(() => {
    if (!aimLocked || !selfSprite) {
      return null;
    }
    const centerX = selfSprite.left + selfSprite.size / 2;
    const centerY = selfSprite.top + selfSprite.size / 2;
    const gap = Math.max(ATTACK_AIM_GAP_PX, selfSprite.size * 0.2);
    const radius = selfSprite.size * 0.58;
    const angle = angleDegFromVector(aimVector.x, aimVector.y);
    const lineStartX = centerX + aimVector.x * gap;
    const lineStartY = centerY + aimVector.y * gap;
    return {
      lineLeft: lineStartX,
      lineTop: lineStartY,
      lineWidth: radius,
      tipLeft: lineStartX + aimVector.x * radius,
      tipTop: lineStartY + aimVector.y * radius,
      angle
    };
  }, [aimLocked, aimVector, selfSprite]);

  // Estável para sempre — usa ref internamente
  const emitAimAttack = useCallback(() => {
    const sendAttack = onAttackRef.current;
    if (!sendAttack) {
      return;
    }
    const direction = normalizeDirection(aimVectorRef.current.x, aimVectorRef.current.y, { x: 1, y: 0 });
    aimVectorRef.current = direction;
    setAimVector(direction);
    sendAttack({ dirX: direction.x, dirY: direction.y, range: ATTACK_RANGE_TILES });
  }, []);

  // Estável para sempre — usa ref internamente
  const stableOnMove = useCallback((input: MoveInput) => {
    onMoveRef.current(input);
  }, []);

  // Registra input UMA VEZ — dependências são estáveis
  useEffect(() => {
    const cleanup = setupInput(stableOnMove, emitAimAttack);
    return cleanup;
  }, [stableOnMove, emitAimAttack]);

  // Pointer lock — registra UMA VEZ com refs
  useEffect(() => {
    const shell = mapShellRef.current;
    if (!shell) {
      return;
    }

    const handlePointerLockChange = () => {
      const locked = document.pointerLockElement === shell;
      setAimLocked(locked);
      if (!locked) {
        onMoveRef.current({ x: 0, y: 0 });
      }
    };

    const handlePointerLockError = () => {
      setAimLocked(false);
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== shell) {
        return;
      }
      const next = normalizeDirection(
        aimVectorRef.current.x + event.movementX * AIM_VECTOR_SENSITIVITY,
        aimVectorRef.current.y + event.movementY * AIM_VECTOR_SENSITIVITY,
        aimVectorRef.current
      );
      aimVectorRef.current = next;
      setAimVector(next);
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || document.pointerLockElement !== shell) {
        return;
      }
      event.preventDefault();
      emitAimAttack();
    };

    document.addEventListener("pointerlockchange", handlePointerLockChange);
    document.addEventListener("pointerlockerror", handlePointerLockError);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mousedown", handleMouseDown);

    return () => {
      document.removeEventListener("pointerlockchange", handlePointerLockChange);
      document.removeEventListener("pointerlockerror", handlePointerLockError);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [emitAimAttack]); // emitAimAttack é estável (useCallback sem deps)

  // Canvas render loop — registra UMA VEZ
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
      const wallNowMs = Date.now();
      const previousFrameAt = lastFrameAtRef.current;
      lastFrameAtRef.current = nowMs;
      const deltaSeconds =
        previousFrameAt === null ? 1 / 60 : Math.min((nowMs - previousFrameAt) / 1000, 0.1);

      const currentWorld = worldRef.current;
      const currentMapDefinition = mapDefinitionRef.current;
      const currentSelfId = selfPlayerIdRef.current;
      const viewportWidth = canvas.clientWidth;
      const viewportHeight = canvas.clientHeight;

      context.clearRect(0, 0, viewportWidth, viewportHeight);
      context.fillStyle = "#0a1117";
      context.fillRect(0, 0, viewportWidth, viewportHeight);

      if (!currentWorld || !currentSelfId) {
        renderedPlayersRef.current.clear();
        attackAnimationByOwnerRef.current.clear();
        nextAttackPhaseTwoByOwnerRef.current.clear();
        setOverlaySprites([]);
        setOverlayHealEffects([]);
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
            playerType: player.playerType,
            facing: "right",
            moving: false,
            hurtUntilMs: 0
          });
          continue;
        }
        if (player.hp < existing.hp) {
          existing.hurtUntilMs = nowMs + 260;
        }
        existing.name = player.name;
        existing.hp = player.hp;
        existing.maxHp = player.maxHp;
        existing.online = player.online;
        existing.playerType = player.playerType;
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
        setOverlayHealEffects([]);
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

      if (currentMapDefinition && currentMapDefinition.mapSize === currentWorld.mapSize) {
        const previousImageSmoothing = context.imageSmoothingEnabled;
        context.imageSmoothingEnabled = false;
        const objectsById = new Map(currentMapDefinition.objects.map((entry) => [entry.id, entry]));
        for (const layer of currentMapDefinition.layers) {
          if (!layer.visible) {
            continue;
          }

          for (let y = 0; y < currentMapDefinition.mapSize; y += 1) {
            for (let x = 0; x < currentMapDefinition.mapSize; x += 1) {
              const objectId = layer.tiles[y]?.[x] ?? null;
              if (!objectId) {
                continue;
              }
              const object = objectsById.get(objectId);
              if (!object) {
                continue;
              }

              let image = mapImageCacheRef.current.get(object.id);
              if (!image) {
                image = new Image();
                image.src = object.imageDataUrl;
                mapImageCacheRef.current.set(object.id, image);
              }
              if (!image.complete) {
                continue;
              }

              // Evita "fendas" visuais entre tiles adjacentes por interpolacao/subpixel.
              const tileOverdraw = object.solid ? 0 : MAP_TILE_OVERDRAW_PX;
              const drawX = renderOffsetX + x * TILE_SIZE;
              const drawY = renderOffsetY + y * TILE_SIZE;
              const drawSize = TILE_SIZE + tileOverdraw;
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
                  drawSize,
                  drawSize
                );
              } else {
                context.drawImage(image, drawX, drawY, drawSize, drawSize);
              }
            }
          }
        }
        context.imageSmoothingEnabled = previousImageSmoothing;
      }

      if (showGridRef.current) {
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
      }

      context.strokeStyle = "rgba(251, 210, 79, 0.65)";
      context.lineWidth = 2;
      context.strokeRect(renderOffsetX, renderOffsetY, mapPixelSize, mapPixelSize);

      const nextHealEffects: OverlayHealEffect[] = [];
      for (const attack of currentWorld.attacks) {
        const centerX = renderOffsetX + attack.x * TILE_SIZE + TILE_SIZE / 2;
        const centerY = renderOffsetY + attack.y * TILE_SIZE + TILE_SIZE / 2;

        if (attack.kind === "heal") {
          // Monk usa efeito visual dedicado no lugar de circulo.
          const effectSize = Math.round(TILE_SIZE * 1.6);
          nextHealEffects.push({
            id: attack.id,
            left: Math.round(centerX - effectSize / 2),
            top: Math.round(centerY - effectSize / 2),
            size: effectSize
          });
          continue;
        }

        const radius = Math.max(TILE_SIZE * 0.18, attack.radius * TILE_SIZE);
        context.fillStyle = "rgba(255, 35, 35, 0.35)";
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "rgba(255, 90, 90, 0.9)";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.stroke();
      }
      setOverlayHealEffects(nextHealEffects);

      const attackAnimations = attackAnimationByOwnerRef.current;
      const nextAttackPhaseTwoByOwner = nextAttackPhaseTwoByOwnerRef.current;
      for (const attack of currentWorld.attacks) {
        const existing = attackAnimations.get(attack.ownerId);
        // Cada attackId deve disparar a animacao visual apenas uma vez.
        // Mesmo que o ataque continue ativo no snapshot do servidor, nao reiniciamos o GIF.
        if (!existing || existing.attackId !== attack.id) {
          const animationDurationMs =
            attack.kind === "heal" ? MONK_HEAL_VISUAL_MS : WARRIOR_ATTACK_VISUAL_MS;
          // Variacao visual entre ataques consecutivos:
          // se esse ataque usar "attack1", o proximo do mesmo player usa "attack2".
          const phaseTwo = nextAttackPhaseTwoByOwner.get(attack.ownerId) ?? false;
          nextAttackPhaseTwoByOwner.set(attack.ownerId, !phaseTwo);
          attackAnimations.set(attack.ownerId, {
            attackId: attack.id,
            kind: attack.kind,
            phaseTwo,
            endsAtMs: wallNowMs + animationDurationMs
          });
        }
      }

      const sprites: OverlaySprite[] = [];
      for (const player of renderedPlayers.values()) {
        const centerX = renderOffsetX + player.x * TILE_SIZE + TILE_SIZE / 2;
        const floorY = renderOffsetY + player.y * TILE_SIZE + TILE_SIZE - 2;
        const spriteSize = TILE_SIZE;
        const drawX = Math.round(centerX - spriteSize / 2);
        const drawY = Math.round(floorY - spriteSize);
        const attackAnimation = attackAnimations.get(player.id) ?? null;
        const attacking = Boolean(attackAnimation && attackAnimation.endsAtMs > wallNowMs);
        const attackPhaseTwo = attacking ? (attackAnimation?.phaseTwo ?? false) : false;
        sprites.push({
          id: player.id,
          name: player.name,
          left: drawX,
          top: drawY,
          size: spriteSize,
          hp: player.hp,
          maxHp: player.maxHp,
          playerType: player.playerType,
          facing: player.facing,
          moving: player.moving,
          hurt: nowMs <= player.hurtUntilMs,
          attacking,
          attackPhaseTwo,
          self: player.id === currentSelfId
        });
      }
      setOverlaySprites(sprites);

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

  const handleMapShellMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const shell = mapShellRef.current;
    if (!shell || document.pointerLockElement === shell) {
      return;
    }
    const rect = shell.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const initialAim = normalizeDirection(event.clientX - centerX, event.clientY - centerY, aimVectorRef.current);
    aimVectorRef.current = initialAim;
    setAimVector(initialAim);
    void shell.requestPointerLock();
  }, []);

  return (
    <div ref={mapShellRef} className="map-shell" onMouseDown={handleMapShellMouseDown}>
      <canvas ref={canvasRef} className="map-canvas" />
      <div className="heal-effect-layer" aria-hidden="true">
        {overlayHealEffects.map((effect) => (
          <img
            key={effect.id}
            src={monkHealEffectGif}
            alt=""
            className="heal-effect-gif"
            style={{
              left: effect.left,
              top: effect.top,
              width: effect.size,
              height: effect.size
            }}
          />
        ))}
      </div>
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
            <div className="player-sprite-health">
              <span style={{ width: `${healthPercent(sprite.hp, sprite.maxHp)}%` }} />
            </div>
            <img
              src={escolherSpriteGif(sprite)}
              alt=""
              className={`player-sprite-img ${sprite.facing === "left" ? "flip-left" : ""}`}
            />
            <span className="player-sprite-name">{sprite.name}</span>
          </div>
        ))}
      </div>

      {aimArrow ? (
        <>
          <div
            className="attack-aim-line"
            style={{
              left: aimArrow.lineLeft,
              top: aimArrow.lineTop,
              width: aimArrow.lineWidth,
              transform: `translateY(-50%) rotate(${aimArrow.angle}deg)`
            }}
          />
          <div
            className="attack-aim-arrow"
            style={{
              left: aimArrow.tipLeft,
              top: aimArrow.tipTop,
              transform: `translate(-50%, -50%) rotate(${aimArrow.angle}deg)`
            }}
          />
        </>
      ) : null}

      {selfPlayerOverlayInfo ? (
        <div className="map-hud" aria-hidden="true">
          <p>Seu player: {selfPlayerOverlayInfo.name}</p>
          <p>
            Pos: ({selfPlayerOverlayInfo.x.toFixed(1)}, {selfPlayerOverlayInfo.y.toFixed(1)})
          </p>
        </div>
      ) : null}

      <p className={`map-aim-hint ${aimLocked ? "active" : ""}`}>
        {aimLocked
          ? "Mira ativa: mova o mouse, clique ou espaco para atacar. ESC libera o cursor."
          : "Clique na arena para travar o mouse e ativar a mira."}
      </p>
      {!hasWorld ? <p className="map-hint">Conectando ao loop do servidor...</p> : null}
    </div>
  );
}
