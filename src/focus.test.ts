import type { Item } from "@owlbear-rodeo/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  scene: {
    isReady: vi.fn(),
    items: {
      getItems: vi.fn(),
      getItemBounds: vi.fn(),
    },
    grid: {
      getDpi: vi.fn(),
    },
  },
  viewport: {
    animateToBounds: vi.fn(),
  },
}));

vi.mock("@owlbear-rodeo/sdk", () => ({ default: sdk }));

import {
  focusViewportOnCharacterItems,
  focusViewportOnPlayerCharacters,
} from "./focus";

function item(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    type: "IMAGE",
    name: id,
    visible: true,
    locked: false,
    createdUserId: "player-1",
    zIndex: 0,
    lastModified: "now",
    lastModifiedUserId: "player-1",
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    metadata: {},
    layer: "CHARACTER",
    ...overrides,
  };
}

describe("viewport focus service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.scene.isReady.mockResolvedValue(true);
    sdk.scene.grid.getDpi.mockResolvedValue(50);
    sdk.scene.items.getItemBounds.mockResolvedValue({
      min: { x: 0, y: 0 },
      max: { x: 100, y: 100 },
      width: 100,
      height: 100,
      center: { x: 50, y: 50 },
    });
    sdk.viewport.animateToBounds.mockResolvedValue(undefined);
  });

  it("frames all visible characters owned by the target player", async () => {
    sdk.scene.items.getItems.mockResolvedValue([
      item("one"),
      item("two"),
      item("hidden", { visible: false }),
      item("other", { createdUserId: "player-2" }),
    ]);

    await expect(focusViewportOnPlayerCharacters("player-1")).resolves.toEqual({
      ok: true,
      itemCount: 2,
    });
    expect(sdk.scene.items.getItemBounds).toHaveBeenCalledWith(["one", "two"]);
    expect(sdk.viewport.animateToBounds).toHaveBeenCalledWith({
      min: { x: -100, y: -100 },
      max: { x: 200, y: 200 },
      width: 300,
      height: 300,
      center: { x: 50, y: 50 },
    });
  });

  it("returns structured results for unavailable scenes and no matches", async () => {
    sdk.scene.isReady.mockResolvedValueOnce(false);
    await expect(focusViewportOnCharacterItems([])).resolves.toEqual({
      ok: false,
      reason: "SCENE_UNAVAILABLE",
    });

    await expect(focusViewportOnCharacterItems([])).resolves.toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
  });

  it("returns an SDK error when bounds or animation fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    sdk.scene.items.getItemBounds.mockRejectedValueOnce(
      new Error("item removed"),
    );
    const result = await focusViewportOnCharacterItems([item("removed")]);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: "SDK_ERROR" });
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });
});
