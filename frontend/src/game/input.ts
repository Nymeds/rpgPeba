import type { Direction } from "../types";

export function setupInput(onMove: (direction: Direction | null) => void): () => void {
  const pressedKeys = new Set<string>();
  let currentDirection: Direction | null = null;

  function resolveDirection(): Direction | null {
    if (pressedKeys.has("w") || pressedKeys.has("arrowup")) {
      return "up";
    }
    if (pressedKeys.has("s") || pressedKeys.has("arrowdown")) {
      return "down";
    }
    if (pressedKeys.has("a") || pressedKeys.has("arrowleft")) {
      return "left";
    }
    if (pressedKeys.has("d") || pressedKeys.has("arrowright")) {
      return "right";
    }
    return null;
  }

  function emitIfChanged(): void {
    const nextDirection = resolveDirection();
    if (nextDirection === currentDirection) {
      return;
    }

    currentDirection = nextDirection;
    onMove(nextDirection);
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const normalized = event.key.toLowerCase();

    if (normalized.startsWith("arrow")) {
      event.preventDefault();
    }

    pressedKeys.add(normalized);
    emitIfChanged();
  };

  const onKeyUp = (event: KeyboardEvent) => {
    pressedKeys.delete(event.key.toLowerCase());
    emitIfChanged();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };
}
