import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  localItems: [] as Array<Record<string, unknown>>,
  scene: {
    items: {
      getItemBounds: vi.fn(),
    },
    local: {
      addItems: vi.fn(),
      deleteItems: vi.fn(),
      getItems: vi.fn(),
      updateItems: vi.fn(),
    },
  },
}));

vi.mock("@owlbear-rodeo/sdk", () => {
  let nextId = 0;
  const buildShape = () => {
    const shape: Record<string, unknown> = {
      id: `indicator-${++nextId}`,
      type: "SHAPE",
      metadata: {},
      style: {},
    };
    const builder = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "build") {
            return () => shape;
          }
          return (value: unknown) => {
            if (property === "metadata") {
              shape.metadata = value;
            } else if (
              property === "fillColor" ||
              property === "fillOpacity" ||
              property === "strokeColor" ||
              property === "strokeOpacity" ||
              property === "strokeWidth"
            ) {
              (shape.style as Record<string, unknown>)[property] = value;
            } else {
              shape[property as string] = value;
            }
            return builder;
          };
        },
      },
    );
    return builder;
  };
  return {
    default: { scene: sdk.scene },
    buildShape,
    isShape: (item: { type?: string }) => item.type === "SHAPE",
  };
});

import {
  calculateIndicatorFrame,
  createIndicatorGeometry,
  showTargetIndicators,
} from "./target-indicator";

const bounds = {
  min: { x: 10, y: 20 },
  max: { x: 110, y: 220 },
  width: 100,
  height: 200,
  center: { x: 60, y: 120 },
};

const character = {
  id: "character-1",
  type: "IMAGE",
  name: "Mira",
  visible: true,
  locked: false,
  createdUserId: "player-1",
  zIndex: 0,
  lastModified: "now",
  lastModifiedUserId: "player-1",
  position: { x: 10, y: 20 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  metadata: {},
  layer: "CHARACTER" as const,
};

describe("target indicator geometry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.localItems.length = 0;
    sdk.scene.items.getItemBounds.mockResolvedValue(bounds);
    sdk.scene.local.getItems.mockImplementation(
      async (filter: (item: Record<string, unknown>) => boolean) =>
        sdk.localItems.filter(filter),
    );
    sdk.scene.local.addItems.mockImplementation(
      async (items: Array<Record<string, unknown>>) => {
        sdk.localItems.push(...items);
      },
    );
    sdk.scene.local.deleteItems.mockImplementation(async (ids: string[]) => {
      const idSet = new Set(ids);
      sdk.localItems.splice(
        0,
        sdk.localItems.length,
        ...sdk.localItems.filter((item) => !idSet.has(item.id as string)),
      );
    });
    sdk.scene.local.updateItems.mockImplementation(
      async (
        ids: string[],
        update: (items: Array<Record<string, unknown>>) => void,
      ) => {
        const idSet = new Set(ids);
        update(sdk.localItems.filter((item) => idSet.has(item.id as string)));
      },
    );
  });

  it("uses the larger token dimension and starts at twenty times its size", () => {
    expect(createIndicatorGeometry(bounds)).toEqual({
      center: { x: 60, y: 120 },
      finalDiameter: 200,
      initialDiameter: 4_000,
    });
  });

  it("skips malformed or empty bounds", () => {
    expect(
      createIndicatorGeometry({ ...bounds, width: 0, height: 0 }),
    ).toBeUndefined();
    expect(
      createIndicatorGeometry({
        ...bounds,
        width: Number.NaN,
        height: Number.NaN,
      }),
    ).toBeUndefined();
  });

  it("shrinks for three seconds and fades for the next two", () => {
    const geometry = createIndicatorGeometry(bounds);
    expect(geometry).toBeDefined();
    if (!geometry) {
      return;
    }

    expect(calculateIndicatorFrame(geometry, 0)).toEqual({
      diameter: 4_000,
      opacity: 1,
      complete: false,
    });
    expect(calculateIndicatorFrame(geometry, 1_500)).toEqual({
      diameter: 2_100,
      opacity: 1,
      complete: false,
    });
    expect(calculateIndicatorFrame(geometry, 3_000)).toEqual({
      diameter: 200,
      opacity: 1,
      complete: false,
    });
    expect(calculateIndicatorFrame(geometry, 4_000)).toEqual({
      diameter: 200,
      opacity: 0.5,
      complete: false,
    });
    expect(calculateIndicatorFrame(geometry, 5_000)).toEqual({
      diameter: 200,
      opacity: 0,
      complete: true,
    });
  });

  it("adds only local items and replaces a previous indicator run", async () => {
    await showTargetIndicators([character], true);
    expect(sdk.scene.local.addItems).toHaveBeenCalledTimes(1);
    expect(sdk.scene.local.addItems).toHaveBeenCalledWith([
      expect.objectContaining({
        type: "SHAPE",
        layer: "CONTROL",
        disableHit: true,
        width: 4_000,
        height: 4_000,
      }),
    ]);
    expect(sdk.scene.local.updateItems).toHaveBeenCalled();

    await showTargetIndicators([character], true);
    expect(sdk.scene.local.deleteItems).toHaveBeenCalledWith([
      expect.stringMatching(/^indicator-/),
    ]);
    expect(sdk.scene.local.addItems).toHaveBeenCalledTimes(2);
  });

  it("cleans existing indicators without adding new ones when disabled", async () => {
    await showTargetIndicators([character], true);
    await showTargetIndicators([character], false);
    expect(sdk.scene.local.deleteItems).toHaveBeenCalled();
    expect(sdk.scene.local.addItems).toHaveBeenCalledTimes(1);
  });

  it("creates and animates one local indicator for every target", async () => {
    const secondCharacter = {
      ...character,
      id: "character-2",
      name: "Kato",
    };
    sdk.scene.items.getItemBounds
      .mockResolvedValueOnce(bounds)
      .mockResolvedValueOnce({
        ...bounds,
        width: 300,
        height: 100,
        center: { x: 400, y: 500 },
      });

    await showTargetIndicators([character, secondCharacter], true);

    expect(sdk.scene.local.addItems).toHaveBeenCalledWith([
      expect.objectContaining({ width: 4_000, height: 4_000 }),
      expect.objectContaining({
        width: 6_000,
        height: 6_000,
        position: { x: -2_600, y: -2_500 },
      }),
    ]);
    expect(sdk.scene.local.updateItems).toHaveBeenCalledWith(
      [
        expect.stringMatching(/^indicator-/),
        expect.stringMatching(/^indicator-/),
      ],
      expect.any(Function),
      true,
    );
  });
});
