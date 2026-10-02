import type { Item } from "@owlbear-rodeo/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  localItems: [] as Array<Record<string, unknown>>,
  scene: {
    items: { getItemBounds: vi.fn() },
    local: {
      addItems: vi.fn(),
      deleteItems: vi.fn(),
      getItems: vi.fn(),
    },
  },
  viewport: {
    getWidth: vi.fn(),
    getHeight: vi.fn(),
    inverseTransformPoint: vi.fn(),
  },
}));

vi.mock("@owlbear-rodeo/sdk", () => {
  let nextId = 0;
  const buildShape = () => {
    const shape: Record<string, unknown> = {
      id: `reticle-${++nextId}`,
      type: "SHAPE",
      metadata: {},
      style: {},
    };
    const builder = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "build") return () => shape;
          return (value: unknown) => {
            if (property === "metadata") shape.metadata = value;
            else if (
              [
                "fillColor",
                "fillOpacity",
                "strokeColor",
                "strokeOpacity",
                "strokeWidth",
                "strokeDash",
              ].includes(property as string)
            ) {
              (shape.style as Record<string, unknown>)[property as string] =
                value;
            } else shape[property as string] = value;
            return builder;
          };
        },
      },
    );
    return builder;
  };
  return { default: sdk, buildShape };
});

import { clearMoveHereReticle, showMoveHereReticle } from "./move-here-reticle";

const character = {
  id: "character-1",
  type: "IMAGE",
  name: "Mira",
  metadata: {},
} as Item;

describe("Move here reticle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.localItems.length = 0;
    sdk.scene.items.getItemBounds.mockResolvedValue({
      min: { x: 0, y: 0 },
      max: { x: 100, y: 160 },
      width: 100,
      height: 160,
      center: { x: 50, y: 80 },
    });
    sdk.viewport.getWidth.mockResolvedValue(800);
    sdk.viewport.getHeight.mockResolvedValue(600);
    sdk.viewport.inverseTransformPoint.mockResolvedValue({ x: 250, y: 400 });
    sdk.scene.local.getItems.mockImplementation(
      async (filter: (item: Item) => boolean) =>
        sdk.localItems.filter((item) => filter(item as unknown as Item)),
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
  });

  it("shows a local square at the viewport center using the token's larger dimension", async () => {
    await showMoveHereReticle(character);

    expect(sdk.viewport.inverseTransformPoint).toHaveBeenCalledWith({
      x: 400,
      y: 300,
    });
    expect(sdk.scene.local.addItems).toHaveBeenCalledWith([
      expect.objectContaining({
        type: "SHAPE",
        shapeType: "RECTANGLE",
        position: { x: 170, y: 320 },
        width: 160,
        height: 160,
        layer: "POPOVER",
        disableHit: true,
      }),
    ]);
  });

  it("removes the reticle when cleared", async () => {
    await showMoveHereReticle(character);
    const id = sdk.localItems[0]?.id;

    await clearMoveHereReticle();

    expect(sdk.scene.local.deleteItems).toHaveBeenCalledWith([id]);
    expect(sdk.localItems).toHaveLength(0);
  });

  it("does not add a reticle after hover has already ended", async () => {
    let resolveBounds: ((value: unknown) => void) | undefined;
    sdk.scene.items.getItemBounds.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveBounds = resolve;
      }),
    );

    const showing = showMoveHereReticle(character);
    await Promise.resolve();
    await clearMoveHereReticle();
    resolveBounds?.({
      width: 100,
      height: 100,
      min: { x: 0, y: 0 },
      max: { x: 100, y: 100 },
      center: { x: 50, y: 50 },
    });
    await showing;

    expect(sdk.scene.local.addItems).not.toHaveBeenCalled();
  });
});
