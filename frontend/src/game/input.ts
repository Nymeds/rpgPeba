import type { MoveInput } from "../types";

type MoveKey = "up" | "down" | "left" | "right";

function clampAxis(value: number): number {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

function sameInput(a: MoveInput, b: MoveInput): boolean {
  return a.x === b.x && a.y === b.y;
}

function keyToMove(code: string, keyLower: string): MoveKey | null {
  if (code === "KeyW" || code === "ArrowUp" || keyLower === "w" || keyLower === "arrowup") return "up";
  if (code === "KeyS" || code === "ArrowDown" || keyLower === "s" || keyLower === "arrowdown") return "down";
  if (code === "KeyA" || code === "ArrowLeft" || keyLower === "a" || keyLower === "arrowleft") return "left";
  if (code === "KeyD" || code === "ArrowRight" || keyLower === "d" || keyLower === "arrowright") return "right";
  return null;
}

export function setupInput(onMove: (input: MoveInput) => void, onAttack?: () => void): () => void {
  const pressedMoves = new Set<MoveKey>();
  let currentInput: MoveInput = { x: 0, y: 0 };
  let moveLoopHandle: number | null = null;

  function resolveInput(): MoveInput {
    const rawX = (pressedMoves.has("right") ? 1 : 0) - (pressedMoves.has("left") ? 1 : 0);
    const rawY = (pressedMoves.has("down") ? 1 : 0) - (pressedMoves.has("up") ? 1 : 0);
    return { x: clampAxis(rawX), y: clampAxis(rawY) };
  }

  function stopMoveLoop(): void {
    if (moveLoopHandle === null) return;
    window.clearInterval(moveLoopHandle);
    moveLoopHandle = null;
  }

  function startMoveLoop(): void {
    if (moveLoopHandle !== null) return;
    // Reenvia o input a cada 50ms enquanto houver tecla pressionada
    // Isso garante que o servidor receba continuamente mesmo que o WebSocket perca um pacote
    moveLoopHandle = window.setInterval(() => {
      if (currentInput.x === 0 && currentInput.y === 0) {
        stopMoveLoop();
        return;
      }
      onMove(currentInput);
    }, 50);
  }

  function emitIfChanged(): void {
    const nextInput = resolveInput();
    const changed = !sameInput(nextInput, currentInput);
    currentInput = nextInput;

    // Sempre emite imediatamente na mudança
    onMove(currentInput);

    if (currentInput.x === 0 && currentInput.y === 0) {
      stopMoveLoop();
    } else {
      // Inicia loop de reenvio contínuo
      startMoveLoop();
    }
  }

  function resetMovement(): void {
    pressedMoves.clear();
    if (currentInput.x !== 0 || currentInput.y !== 0) {
      currentInput = { x: 0, y: 0 };
      onMove(currentInput);
    }
    stopMoveLoop();
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const keyLower = event.key.toLowerCase();
    const code = event.code;

    // Não bloqueia input se foco estiver em campo de texto
    const target = event.target as HTMLElement;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      return;
    }

    if (code === "Escape" || keyLower === "escape") {
      resetMovement();
      return;
    }

    if (code === "Space" || keyLower === " " || keyLower === "spacebar") {
      event.preventDefault();
      if (!event.repeat) {
        onAttack?.();
      }
      return;
    }

    const move = keyToMove(code, keyLower);
    if (!move) return;

    event.preventDefault();
    if (pressedMoves.has(move)) return; // Ignora key repeat
    pressedMoves.add(move);
    emitIfChanged();
  };

  const onKeyUp = (event: KeyboardEvent) => {
    const keyLower = event.key.toLowerCase();
    const code = event.code;

    if (code === "Space" || keyLower === " " || keyLower === "spacebar") return;

    const move = keyToMove(code, keyLower);
    if (!move) return;

    event.preventDefault();
    pressedMoves.delete(move);
    emitIfChanged();
  };

  const onWindowBlur = () => {
    resetMovement();
  };

  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onWindowBlur);

  return () => {
    stopMoveLoop();
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onWindowBlur);
  };
}