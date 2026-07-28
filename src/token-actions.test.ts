import type { Item } from "@owlbear-rodeo/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  player: { getRole: vi.fn() },
  scene: {
    isReady: vi.fn(),
    items: {
      getItems: vi.fn(),
      updateItems: vi.fn(),
    },
  },
  viewport: {
    getWidth: vi.fn(),
    getHeight: vi.fn(),
    inverseTransformPoint: vi.fn(),
  },
}));

vi.mock("@owlbear-rodeo/sdk", () => ({ default: sdk }));

import {
  getGmCharacterToken,
  moveCharacterTokenToViewportCenter,
  toggleCharacterTokenVisibility,
} from "./token-actions";

function character(overrides: Partial<Item> = {}): Item {
  return {
    id: "character-1",
    type: "IMAGE",
    name: "Mira",
    visible: true,
    locked: false,
    createdUserId: "player-1",
    zIndex: 4,
    lastModified: "now",
    lastModifiedUserId: "player-1",
    position: { x: 10, y: 20 },
    rotation: 45,
    scale: { x: 2, y: 2 },
    metadata: { preserved: true },
    layer: "CHARACTER",
    ...overrides,
  };
}

describe("GM character-token actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.player.getRole.mockResolvedValue("GM");
    sdk.scene.isReady.mockResolvedValue(true);
    sdk.scene.items.getItems.mockResolvedValue([character()]);
    sdk.scene.items.updateItems.mockImplementation(
      async (items: Item[], update: (drafts: Item[]) => void) => update(items),
    );
    sdk.viewport.getWidth.mockResolvedValue(800);
    sdk.viewport.getHeight.mockResolvedValue(600);
    sdk.viewport.inverseTransformPoint.mockResolvedValue({ x: 120, y: 240 });
  });

  it("rejects non-GMs, unavailable scenes, and removed tokens", async () => {
    sdk.player.getRole.mockResolvedValueOnce("PLAYER");
    await expect(getGmCharacterToken("character-1")).rejects.toThrow(
      "Only a GM",
    );

    sdk.scene.isReady.mockResolvedValueOnce(false);
    await expect(getGmCharacterToken("character-1")).rejects.toThrow(
      "No scene",
    );

    sdk.scene.items.getItems.mockResolvedValueOnce([]);
    await expect(getGmCharacterToken("character-1")).rejects.toThrow(
      "no longer",
    );
  });

  it("toggles only the token visibility", async () => {
    const item = character();
    sdk.scene.items.getItems.mockResolvedValue([item]);
    await expect(toggleCharacterTokenVisibility(item.id)).resolves.toBe(false);
    expect(item).toMatchObject({
      visible: false,
      position: { x: 10, y: 20 },
      rotation: 45,
      scale: { x: 2, y: 2 },
      metadata: { preserved: true },
    });
  });

  it("moves only the token position to the scene-space viewport center", async () => {
    const item = character();
    sdk.scene.items.getItems.mockResolvedValue([item]);
    await moveCharacterTokenToViewportCenter(item.id);
    expect(sdk.viewport.inverseTransformPoint).toHaveBeenCalledWith({
      x: 400,
      y: 300,
    });
    expect(item).toMatchObject({
      visible: true,
      position: { x: 120, y: 240 },
      rotation: 45,
      scale: { x: 2, y: 2 },
      metadata: { preserved: true },
    });
  });

  it("propagates scene update failures", async () => {
    sdk.scene.items.updateItems.mockRejectedValueOnce(new Error("denied"));
    await expect(toggleCharacterTokenVisibility("character-1")).rejects.toThrow(
      "denied",
    );
  });
});
