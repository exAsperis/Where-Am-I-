import type { Item } from "@owlbear-rodeo/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    animateTo: vi.fn(),
    animateToBounds: vi.fn(),
    getPosition: vi.fn(),
    getScale: vi.fn(),
    getWidth: vi.fn(),
    getHeight: vi.fn(),
  },
}));
const highlight = vi.hoisted(() => ({
  showHighlights: vi.fn(),
}));

vi.mock("@owlbear-rodeo/sdk", () => ({ default: sdk }));
vi.mock("./highlight", () => highlight);

import {
  focusViewportOnCharacterItems,
  focusViewportOnItems,
  focusViewportOnPlayerCharacters,
  highlightCharacterItems,
  highlightItems,
} from "./target-actions";

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
    sdk.viewport.animateTo.mockResolvedValue(undefined);
    sdk.viewport.getPosition.mockResolvedValue({ x: 50, y: 50 });
    sdk.viewport.getScale.mockResolvedValue(0.5);
    sdk.viewport.getWidth.mockResolvedValue(800);
    sdk.viewport.getHeight.mockResolvedValue(600);
    highlight.showHighlights.mockResolvedValue(undefined);
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: TimerHandler,
    ) => {
      if (typeof callback === "function") callback();
      return 0;
    }) as typeof setTimeout);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(highlight.showHighlights).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "one" })],
      true,
      undefined,
    );
  });

  it("waits 500ms after viewport movement before starting the highlight", async () => {
    await focusViewportOnCharacterItems([item("one")]);

    expect(globalThis.setTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      500,
    );
    expect(
      sdk.viewport.animateToBounds.mock.invocationCallOrder[0],
    ).toBeLessThan(
      highlight.showHighlights.mock.invocationCallOrder[0] ?? Infinity,
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

  it("can explicitly focus a hidden Character-layer token for the GM", async () => {
    await expect(
      focusViewportOnCharacterItems(
        [item("hidden", { visible: false })],
        0.5,
        true,
        true,
      ),
    ).resolves.toEqual({ ok: true, itemCount: 1 });
    expect(sdk.scene.items.getItemBounds).toHaveBeenCalledWith(["hidden"]);
  });

  it("still focuses when highlight setup fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    highlight.showHighlights.mockRejectedValueOnce(
      new Error("local scene unavailable"),
    );

    await expect(focusViewportOnCharacterItems([item("one")])).resolves.toEqual(
      { ok: true, itemCount: 1 },
    );
    expect(sdk.viewport.animateToBounds).toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("does not mutate the viewport when Highlight targets already fit", async () => {
    await expect(
      highlightCharacterItems([item("one")], false, "#123456"),
    ).resolves.toEqual({
      ok: true,
      itemCount: 1,
    });
    expect(highlight.showHighlights).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "one" })],
      true,
      "#123456",
    );
    expect(sdk.scene.items.getItemBounds).toHaveBeenCalledWith(["one"]);
    expect(sdk.viewport.getWidth).toHaveBeenCalled();
    expect(sdk.viewport.animateTo).not.toHaveBeenCalled();
    expect(sdk.viewport.animateToBounds).not.toHaveBeenCalled();
  });

  it("zooms out at the same viewport position before explicit Highlight", async () => {
    sdk.scene.items.getItemBounds.mockResolvedValueOnce({
      min: { x: -1_000, y: -600 },
      max: { x: 1_000, y: 600 },
      width: 2_000,
      height: 1_200,
      center: { x: 0, y: 0 },
    });
    sdk.viewport.getPosition.mockResolvedValueOnce({ x: 0, y: 0 });

    await expect(highlightItems([item("one")], "#123456")).resolves.toEqual({
      ok: true,
      itemCount: 1,
    });

    expect(sdk.viewport.animateTo).toHaveBeenCalledWith({
      position: { x: 0, y: 0 },
      scale: 0.4,
    });
    expect(sdk.viewport.animateToBounds).not.toHaveBeenCalled();
    expect(sdk.viewport.animateTo.mock.invocationCallOrder[0]).toBeLessThan(
      highlight.showHighlights.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("still highlights when zoom-only viewport adjustment fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    sdk.viewport.getScale.mockRejectedValueOnce(new Error("viewport missing"));

    await expect(highlightCharacterItems([item("one")])).resolves.toEqual({
      ok: true,
      itemCount: 1,
    });
    expect(highlight.showHighlights).toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      "Where am I? could not fit Highlight targets.",
      expect.any(Error),
    );
    errorLog.mockRestore();
  });

  it("focuses and highlights non-character items for GM context actions", async () => {
    const prop = item("prop", { layer: "PROP" });
    await expect(highlightItems([prop])).resolves.toEqual({
      ok: true,
      itemCount: 1,
    });
    await expect(focusViewportOnItems([prop], 0.5, false)).resolves.toEqual({
      ok: true,
      itemCount: 1,
    });
    expect(sdk.viewport.animateToBounds).toHaveBeenCalled();
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
      min: { x: -750, y: -550 },
      max: { x: 850, y: 650 },
      width: 1600,
      height: 1200,
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
