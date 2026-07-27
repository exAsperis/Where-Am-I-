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
    getWidth: vi.fn(),
    getHeight: vi.fn(),
  },
}));
const indicator = vi.hoisted(() => ({
  showTargetIndicators: vi.fn(),
}));

vi.mock("@owlbear-rodeo/sdk", () => ({ default: sdk }));
vi.mock("./target-indicator", () => indicator);

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
    sdk.viewport.getWidth.mockResolvedValue(800);
    sdk.viewport.getHeight.mockResolvedValue(600);
    indicator.showTargetIndicators.mockResolvedValue(undefined);
  });

  it("defaults to 50% zoom for a single character", async () => {
    const result = await focusViewportOnCharacterItems([item("one")]);

    expect(result).toEqual({ ok: true, itemCount: 1 });
    expect(sdk.viewport.animateToBounds).toHaveBeenCalledWith({
      min: { x: -750, y: -550 },
      max: { x: 850, y: 650 },
      width: 1600,
      height: 1200,
      center: { x: 50, y: 50 },
    });
    expect(sdk.scene.grid.getDpi).not.toHaveBeenCalled();
    expect(indicator.showTargetIndicators).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "one" })],
      true,
    );
  });

  it("focuses a requested token only when it is visible and owned by the target player", async () => {
    sdk.scene.items.getItems.mockResolvedValue([
      item("owned"),
      item("other", { createdUserId: "player-2" }),
      item("hidden", { visible: false }),
    ]);

    await expect(
      focusViewportOnPlayerCharacters("player-1", 0.5, true, "owned"),
    ).resolves.toEqual({ ok: true, itemCount: 1 });
    await expect(
      focusViewportOnPlayerCharacters("player-1", 0.5, true, "other"),
    ).resolves.toEqual({ ok: false, reason: "NOT_FOUND" });
    await expect(
      focusViewportOnPlayerCharacters("player-1", 0.5, true, "hidden"),
    ).resolves.toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("still focuses when target indicator setup fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    indicator.showTargetIndicators.mockRejectedValueOnce(
      new Error("local scene unavailable"),
    );

    await expect(focusViewportOnCharacterItems([item("one")])).resolves.toEqual(
      { ok: true, itemCount: 1 },
    );
    expect(sdk.viewport.animateToBounds).toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
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
