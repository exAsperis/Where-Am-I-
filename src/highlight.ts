import OBR, {
  buildShape,
  isShape,
  type BoundingBox,
  type Item,
} from "@owlbear-rodeo/sdk";

import {
  HIGHLIGHT_COLOR,
  HIGHLIGHT_FADE_MS,
  HIGHLIGHT_FRAME_MS,
  HIGHLIGHT_INITIAL_SCALE,
  HIGHLIGHT_METADATA_KEY,
  HIGHLIGHT_SHRINK_MS,
  HIGHLIGHT_STROKE_WIDTH,
} from "./constants";

export interface HighlightGeometry {
  center: { x: number; y: number };
  finalDiameter: number;
  initialDiameter: number;
}

export interface HighlightFrame {
  diameter: number;
  opacity: number;
  complete: boolean;
}

export function createHighlightGeometry(
  bounds: BoundingBox,
): HighlightGeometry | undefined {
  const finalDiameter = Math.max(bounds.width, bounds.height);
  if (!Number.isFinite(finalDiameter) || finalDiameter <= 0) {
    return undefined;
  }
  return {
    center: { ...bounds.center },
    finalDiameter,
    initialDiameter: finalDiameter * HIGHLIGHT_INITIAL_SCALE,
  };
}

export function calculateHighlightFrame(
  geometry: HighlightGeometry,
  elapsedMs: number,
): HighlightFrame {
  const safeElapsed = Math.max(0, elapsedMs);
  const shrinkProgress = Math.min(1, safeElapsed / HIGHLIGHT_SHRINK_MS);
  const diameter =
    geometry.initialDiameter +
    (geometry.finalDiameter - geometry.initialDiameter) * shrinkProgress;
  const fadeProgress = Math.min(
    1,
    Math.max(0, safeElapsed - HIGHLIGHT_SHRINK_MS) / HIGHLIGHT_FADE_MS,
  );
  return {
    diameter,
    opacity: 1 - fadeProgress,
    complete: safeElapsed >= HIGHLIGHT_SHRINK_MS + HIGHLIGHT_FADE_MS,
  };
}

type ActiveAnimation = {
  generation: number;
  ids: string[];
};

let animationGeneration = 0;
let activeAnimation: ActiveAnimation | undefined;

function isHighlight(item: Item): boolean {
  return item.metadata[HIGHLIGHT_METADATA_KEY] === true;
}

async function deleteHighlights(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await OBR.scene.local.deleteItems([...ids]);
}

export async function clearHighlights(): Promise<void> {
  animationGeneration += 1;
  const activeIds = activeAnimation?.ids ?? [];
  activeAnimation = undefined;
  try {
    const existing = await OBR.scene.local.getItems(isHighlight);
    await deleteHighlights([
      ...new Set([...activeIds, ...existing.map((item) => item.id)]),
    ]);
  } catch (error) {
    console.error("Where am I? could not clear highlights.", error);
  }
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, HIGHLIGHT_FRAME_MS);
  });
}

async function animateHighlights(
  generation: number,
  ids: string[],
  geometries: HighlightGeometry[],
): Promise<void> {
  const startedAt = Date.now();
  try {
    while (generation === animationGeneration) {
      const elapsed = Date.now() - startedAt;
      const frames = geometries.map((geometry) =>
        calculateHighlightFrame(geometry, elapsed),
      );
      const complete = frames.every((frame) => frame.complete);
      if (complete) {
        break;
      }
      const fading = elapsed >= HIGHLIGHT_SHRINK_MS;
      await OBR.scene.local.updateItems(
        ids,
        (items) => {
          for (let index = 0; index < items.length; index += 1) {
            const item = items[index];
            const frame = frames[index];
            const geometry = geometries[index];
            if (!item || !frame || !geometry || !isShape(item)) {
              continue;
            }
            item.width = frame.diameter;
            item.height = frame.diameter;
            item.position = { ...geometry.center };
            if (fading) {
              item.style.strokeOpacity = frame.opacity;
            }
          }
        },
        !fading,
      );
      await waitForNextFrame();
    }
  } catch (error) {
    console.error("Where am I? highlight animation failed.", error);
  } finally {
    try {
      await deleteHighlights(ids);
    } catch (error) {
      console.error("Where am I? could not remove highlights.", error);
    }
    if (activeAnimation?.generation === generation) {
      activeAnimation = undefined;
    }
  }
}

export async function showHighlights(
  items: readonly Item[],
  enabled: boolean,
  color = HIGHLIGHT_COLOR,
): Promise<void> {
  await clearHighlights();
  if (!enabled || items.length === 0) {
    return;
  }

  try {
    const bounds = await Promise.all(
      items.map((item) => OBR.scene.items.getItemBounds([item.id])),
    );
    const targets = bounds
      .map((itemBounds, index) => ({
        geometry: createHighlightGeometry(itemBounds),
        item: items[index],
      }))
      .filter(
        (target): target is { geometry: HighlightGeometry; item: Item } =>
          target.geometry !== undefined && target.item !== undefined,
      );
    if (targets.length === 0) {
      return;
    }

    const shapes = targets.map(({ geometry, item }) =>
      buildShape()
        .name(`Where am I? highlight: ${item.name}`)
        .position({ ...geometry.center })
        .width(geometry.initialDiameter)
        .height(geometry.initialDiameter)
        .shapeType("CIRCLE")
        .fillColor(color)
        .fillOpacity(0)
        .strokeColor(color)
        .strokeOpacity(1)
        .strokeWidth(HIGHLIGHT_STROKE_WIDTH)
        .locked(true)
        .disableHit(true)
        .disableAutoZIndex(true)
        .zIndex(1_000_000)
        .layer("CONTROL")
        .metadata({ [HIGHLIGHT_METADATA_KEY]: true })
        .build(),
    );
    await OBR.scene.local.addItems(shapes);

    const generation = animationGeneration;
    const ids = shapes.map((shape) => shape.id);
    activeAnimation = { generation, ids };
    void animateHighlights(
      generation,
      ids,
      targets.map(({ geometry }) => geometry),
    );
  } catch (error) {
    console.error("Where am I? could not show highlights.", error);
  }
}
