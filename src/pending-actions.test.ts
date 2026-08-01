import type { Item, Metadata } from "@owlbear-rodeo/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PENDING_PARTY_ACTIONS_METADATA_KEY } from "./constants";

const state = vi.hoisted(() => ({
  metadata: {} as Metadata,
  items: [] as Item[],
}));
const sdk = vi.hoisted(() => ({
  scene: {
    isReady: vi.fn(),
    getMetadata: vi.fn(async () => state.metadata),
    setMetadata: vi.fn(async (update: Metadata) => {
      state.metadata = { ...state.metadata, ...update };
    }),
    items: {
      getItems: vi.fn(async (ids: string[]) =>
        state.items.filter((item) => ids.includes(item.id)),
      ),
      updateItems: vi.fn(
        async (ids: string[], update: (items: Item[]) => void) => {
          update(state.items.filter((item) => ids.includes(item.id)));
        },
      ),
    },
  },
}));

vi.mock("@owlbear-rodeo/sdk", () => ({ default: sdk }));

import {
  cancelPendingPartyActionsForItems,
  findPendingConflict,
  formatPendingCanceledToast,
  formatPendingConfiguredToast,
  formatPendingConflictToast,
  getPendingTargetState,
  isElectedPendingExecutor,
  queuePendingPartyAction,
  readPendingPartyActions,
  type PendingPartyAction,
} from "./pending-actions";

function item(id: string, visible: boolean, name = id): Item {
  return {
    id,
    type: "IMAGE",
    name,
    visible,
    locked: false,
    createdUserId: "gm",
    zIndex: 0,
    lastModified: "now",
    lastModifiedUserId: "gm",
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    metadata: {},
    layer: "CHARACTER",
  };
}

function pending(
  id: string,
  action: "FOCUS" | "HIGHLIGHT",
  targetIds: string[],
): PendingPartyAction {
  return {
    id,
    executionRequestId: `request-${id}`,
    action,
    targetIds,
    targetMode: "ALL_ITEMS",
    actorName: "GM Ada",
    targetLabel: targetIds.join(" and "),
    createdAt: 1_000,
  };
}

describe("pending Party actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.metadata = {};
    state.items = [];
    sdk.scene.isReady.mockResolvedValue(true);
  });

  it("rejects malformed and overlapping persisted groups", () => {
    const first = pending("one", "FOCUS", ["a", "b"]);
    const overlap = pending("two", "HIGHLIGHT", ["b", "c"]);
    expect(
      readPendingPartyActions({
        [PENDING_PARTY_ACTIONS_METADATA_KEY]: [
          { invalid: true },
          first,
          overlap,
        ],
      }),
    ).toEqual([first]);
  });

  it("deduplicates IDs and queues disjoint groups", async () => {
    state.items = [item("a", false), item("b", true), item("c", false)];
    const first = await queuePendingPartyAction({
      action: "FOCUS",
      targetIds: ["a", "a", "b"],
      targetMode: "ALL_ITEMS",
      actorName: "GM Ada",
      targetLabel: "two items",
    });
    expect(first.kind).toBe("QUEUED");
    if (first.kind !== "QUEUED") return;
    expect(first.pending.targetIds).toEqual(["a", "b"]);

    const second = await queuePendingPartyAction({
      action: "HIGHLIGHT",
      targetIds: ["c"],
      targetMode: "ALL_ITEMS",
      actorName: "GM Ada",
      targetLabel: "c",
    });
    expect(second.kind).toBe("QUEUED");
    expect(
      readPendingPartyActions(state.metadata).map((entry) => entry.targetIds),
    ).toEqual([["a", "b"], ["c"]]);
  });

  it("rejects the entire request when any item is already grouped", async () => {
    const existing = pending("one", "FOCUS", ["a"]);
    state.metadata = { [PENDING_PARTY_ACTIONS_METADATA_KEY]: [existing] };
    state.items = [item("a", false, "Ancient Dragon"), item("b", false)];

    const result = await queuePendingPartyAction({
      action: "HIGHLIGHT",
      targetIds: ["a", "b"],
      targetMode: "ALL_ITEMS",
      actorName: "GM Ada",
      targetLabel: "two items",
    });
    expect(result).toMatchObject({ kind: "CONFLICT", pending: existing });
    expect(readPendingPartyActions(state.metadata)).toEqual([existing]);
    expect(findPendingConflict([existing], ["b"])).toBeUndefined();
  });

  it("returns READY without persistence when every target is visible", async () => {
    state.items = [item("a", true), item("b", true)];
    await expect(
      queuePendingPartyAction({
        action: "FOCUS",
        targetIds: ["a", "b"],
        targetMode: "ALL_ITEMS",
        actorName: "GM Ada",
        targetLabel: "two items",
      }),
    ).resolves.toEqual({ kind: "READY", targetIds: ["a", "b"] });
    expect(sdk.scene.setMetadata).not.toHaveBeenCalled();
  });

  it("cancels the whole group through any member and preserves other groups", async () => {
    const first = pending("one", "FOCUS", ["a", "b"]);
    const second = pending("two", "HIGHLIGHT", ["c"]);
    state.metadata = {
      [PENDING_PARTY_ACTIONS_METADATA_KEY]: [first, second],
    };
    state.items = [item("a", false), item("b", true), item("c", false)];

    await expect(
      cancelPendingPartyActionsForItems("FOCUS", ["b"]),
    ).resolves.toEqual([first]);
    expect(readPendingPartyActions(state.metadata)).toEqual([second]);
    expect(state.items[0]?.metadata).toMatchObject({
      "com.ex-asperis.whereami/pending-party-group": null,
    });
  });

  it("waits for all targets and detects deletion", () => {
    const group = pending("one", "FOCUS", ["a", "b"]);
    expect(
      getPendingTargetState(group, [
        { id: "a", visible: true },
        { id: "b", visible: false },
      ]),
    ).toBe("HIDDEN");
    expect(
      getPendingTargetState(group, [
        { id: "a", visible: true },
        { id: "b", visible: true },
      ]),
    ).toBe("READY");
    expect(getPendingTargetState(group, [{ id: "a", visible: true }])).toBe(
      "MISSING",
    );
  });

  it("elects one deterministic GM executor", () => {
    const players = [
      { connectionId: "gm-b", role: "GM" as const },
      { connectionId: "player", role: "PLAYER" as const },
    ];
    expect(isElectedPendingExecutor("gm-a", players)).toBe(true);
    expect(isElectedPendingExecutor("gm-c", players)).toBe(false);
  });

  it("formats configuration, conflict, and cancellation feedback", () => {
    const group = pending("one", "FOCUS", ["a"]);
    group.targetLabel = "Ancient Dragon";
    expect(formatPendingConfiguredToast(group)).toBe(
      "Focus for Party is pending for Ancient Dragon until the target is visible.",
    );
    expect(
      formatPendingConflictToast(
        "HIGHLIGHT",
        { name: "Ancient Dragon" },
        group,
      ),
    ).toContain("already belongs to a pending Focus for Party action");
    expect(formatPendingCanceledToast(group)).toBe(
      "Pending Focus for Party canceled for Ancient Dragon.",
    );
  });
});
