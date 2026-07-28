import OBR, {
  buildShape,
  isShape,
  type BoundingBox,
  type Item,
} from "@owlbear-rodeo/sdk";

import {
  TARGET_INDICATOR_COLOR,
  TARGET_INDICATOR_FADE_MS,
  TARGET_INDICATOR_FRAME_MS,
  TARGET_INDICATOR_INITIAL_SCALE,
  TARGET_INDICATOR_METADATA_KEY,
  TARGET_INDICATOR_SHRINK_MS,
  TARGET_INDICATOR_STROKE_WIDTH,
} from "./constants";

export interface IndicatorGeometry {
  center: { x: number; y: number };
  finalDiameter: number;
  initialDiameter: number;
}

export interface IndicatorFrame {
  diameter: number;
  opacity: number;
  complete: boolean;
}

export function createIndicatorGeometry(
  bounds: BoundingBox,
): IndicatorGeometry | undefined {
  const finalDiameter = Math.max(bounds.width, bounds.height);
  if (!Number.isFinite(finalDiameter) || finalDiameter <= 0) {
    return undefined;
  }
  return {
    center: { ...bounds.center },
    finalDiameter,
    initialDiameter: finalDiameter * TARGET_INDICATOR_INITIAL_SCALE,
  };
}

export function calculateIndicatorFrame(
  geometry: IndicatorGeometry,
  elapsedMs: number,
): IndicatorFrame {
  const safeElapsed = Math.max(0, elapsedMs);
  const shrinkProgress = Math.min(1, safeElapsed / TARGET_INDICATOR_SHRINK_MS);
  const diameter =
    geometry.initialDiameter +
    (geometry.finalDiameter - geometry.initialDiameter) * shrinkProgress;
  const fadeProgress = Math.min(
    1,
    Math.max(0, safeElapsed - TARGET_INDICATOR_SHRINK_MS) /
      TARGET_INDICATOR_FADE_MS,
  );
  return {
    diameter,
    opacity: 1 - fadeProgress,
    complete:
      safeElapsed >= TARGET_INDICATOR_SHRINK_MS + TARGET_INDICATOR_FADE_MS,
  };
}

type ActiveAnimation = {
  generation: number;
  ids: string[];
};

let animationGeneration = 0;
let activeAnimation: ActiveAnimation | undefined;

function isTargetIndicator(item: Item): boolean {
  return item.metadata[TARGET_INDICATOR_METADATA_KEY] === true;
}

async function deleteIndicators(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await OBR.scene.local.deleteItems([...ids]);
}

export async function clearTargetIndicators(): Promise<void> {
  animationGeneration += 1;
  const activeIds = activeAnimation?.ids ?? [];
  activeAnimation = undefined;
  try {
    const existing = await OBR.scene.local.getItems(isTargetIndicator);
    await deleteIndicators([
      ...new Set([...activeIds, ...existing.map((item) => item.id)]),
    ]);
  } catch (error) {
    console.error("Where am I? could not clear target indicators.", error);
  }
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, TARGET_INDICATOR_FRAME_MS);
  });
}

async function animateIndicators(
  generation: number,
  ids: string[],
  geometries: IndicatorGeometry[],
): Promise<void> {
  const startedAt = Date.now();
  try {
    while (generation === animationGeneration) {
      const elapsed = Date.now() - startedAt;
      const frames = geometries.map((geometry) =>
        calculateIndicatorFrame(geometry, elapsed),
      );
      const complete = frames.every((frame) => frame.complete);
      if (complete) {
        break;
      }
      const fading = elapsed >= TARGET_INDICATOR_SHRINK_MS;
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
    console.error("Where am I? target indicator animation failed.", error);
  } finally {
    try {
      await deleteIndicators(ids);
    } catch (error) {
      console.error("Where am I? could not remove target indicators.", error);
    }
    if (activeAnimation?.generation === generation) {
      activeAnimation = undefined;
    }
  }
}

export async function showTargetIndicators(
  items: readonly Item[],
  enabled: boolean,
): Promise<void> {
  await clearTargetIndicators();
  if (!enabled || items.length === 0) {
    return;
  }

  try {
    const bounds = await Promise.all(
      items.map((item) => OBR.scene.items.getItemBounds([item.id])),
    );
    const targets = bounds
      .map((itemBounds, index) => ({
        geometry: createIndicatorGeometry(itemBounds),
        item: items[index],
      }))
      .filter(
        (target): target is { geometry: IndicatorGeometry; item: Item } =>
          target.geometry !== undefined && target.item !== undefined,
      );
    if (targets.length === 0) {
      return;
    }

    const shapes = targets.map(({ geometry, item }) =>
      buildShape()
        .name(`Where am I? target: ${item.name}`)
        .position({ ...geometry.center })
        .width(geometry.initialDiameter)
        .height(geometry.initialDiameter)
        .shapeType("CIRCLE")
        .fillColor(TARGET_INDICATOR_COLOR)
        .fillOpacity(0)
        .strokeColor(TARGET_INDICATOR_COLOR)
        .strokeOpacity(1)
        .strokeWidth(TARGET_INDICATOR_STROKE_WIDTH)
        .locked(true)
        .disableHit(true)
        .disableAutoZIndex(true)
        .zIndex(1_000_000)
        .layer("CONTROL")
        .metadata({ [TARGET_INDICATOR_METADATA_KEY]: true })
        .build(),
    );
    await OBR.scene.local.addItems(shapes);

    const generation = animationGeneration;
    const ids = shapes.map((shape) => shape.id);
    activeAnimation = { generation, ids };
    void animateIndicators(
      generation,
      ids,
      targets.map(({ geometry }) => geometry),
    );
  } catch (error) {
    console.error("Where am I? could not show target indicators.", error);
  }
}
