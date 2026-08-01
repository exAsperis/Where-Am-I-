import { describe, expect, it } from "vitest";

import {
  RecentRequestIds,
  createLegacyFocusCommand,
  createTargetActionCommand,
  isLegacyFocusCommand,
  isTargetActionCommand,
  routeTargetAction,
  type TargetActionCommand,
} from "./remote-actions";

const now = 1_000_000;
const command: TargetActionCommand = {
  type: "TARGET_ACTION",
  action: "HIGHLIGHT",
  recipient: { scope: "PARTY" },
  targetCharacterIds: ["character-1"],
  includeHidden: false,
  requestId: "request-1",
  sentAt: now,
};
const connectedPlayers = [
  { connectionId: "gm-connection", role: "GM" as const },
  { connectionId: "player-connection", role: "PLAYER" as const },
];

function route(
  overrides: Partial<Parameters<typeof routeTargetAction>[0]> = {},
) {
  return routeTargetAction({
    data: command,
    currentPlayerId: "player-1",
    senderConnectionId: "gm-connection",
    connectedPlayers,
    globalEnabled: true,
    recentRequestIds: new RecentRequestIds(),
    now,
    ...overrides,
  });
}

describe("remote target action validation and routing", () => {
  it("validates the complete action and recipient shapes", () => {
    expect(isTargetActionCommand(command)).toBe(true);
    expect(isTargetActionCommand({ ...command, action: "MOVE" })).toBe(false);
    expect(isTargetActionCommand({ ...command, targetCharacterIds: [] })).toBe(
      false,
    );
    expect(isTargetActionCommand({ ...command, includeHidden: "yes" })).toBe(
      false,
    );
    expect(
      isTargetActionCommand({
        ...command,
        recipient: { scope: "PLAYER", playerId: "player-1" },
      }),
    ).toBe(true);
  });

  it("creates focus and highlight commands for player and party recipients", () => {
    expect(
      createTargetActionCommand(
        "FOCUS",
        { scope: "PLAYER", playerId: "player-1" },
        ["one"],
      ),
    ).toMatchObject({
      type: "TARGET_ACTION",
      action: "FOCUS",
      recipient: { scope: "PLAYER", playerId: "player-1" },
      targetCharacterIds: ["one"],
      includeHidden: false,
    });
  });

  it("creates and validates all-item party commands for context-menu actions", () => {
    const contextCommand = createTargetActionCommand(
      "HIGHLIGHT",
      { scope: "PARTY" },
      ["prop-1", "drawing-1"],
      true,
      "ALL_ITEMS",
    );
    expect(isTargetActionCommand(contextCommand)).toBe(true);
    expect(contextCommand).toMatchObject({
      recipient: { scope: "PARTY" },
      targetCharacterIds: ["prop-1", "drawing-1"],
      targetMode: "ALL_ITEMS",
    });
  });

  it("accepts party commands for every player and filters single-player commands", () => {
    expect(route().execute).toBe(true);
    expect(
      route({
        data: {
          ...command,
          recipient: { scope: "PLAYER", playerId: "player-2" },
        },
      }),
    ).toEqual({ execute: false, reason: "WRONG_TARGET" });
  });

  it("accepts the legacy focus command shape", () => {
    const legacy = {
      type: "FOCUS_OWNED_CHARACTERS",
      targetPlayerId: "player-1",
      requestId: "legacy-1",
      sentAt: now,
    };
    expect(isLegacyFocusCommand(legacy)).toBe(true);
    expect(route({ data: legacy })).toMatchObject({
      execute: true,
      routed: { kind: "LEGACY_FOCUS" },
    });
  });

  it("creates a legacy command with the new command request ID", () => {
    expect(
      createLegacyFocusCommand("player-1", "shared-request", "character-1"),
    ).toMatchObject({
      type: "FOCUS_OWNED_CHARACTERS",
      targetPlayerId: "player-1",
      targetCharacterId: "character-1",
      requestId: "shared-request",
    });
  });

  it("rejects unauthorized, disabled, stale, and duplicate commands", () => {
    expect(route({ senderConnectionId: "player-connection" })).toEqual({
      execute: false,
      reason: "UNAUTHORIZED",
    });
    expect(route({ globalEnabled: false })).toEqual({
      execute: false,
      reason: "DISABLED",
    });
    expect(route({ data: { ...command, sentAt: now - 30_001 } })).toEqual({
      execute: false,
      reason: "STALE",
    });
    const recentRequestIds = new RecentRequestIds();
    expect(route({ recentRequestIds }).execute).toBe(true);
    expect(route({ recentRequestIds })).toEqual({
      execute: false,
      reason: "DUPLICATE",
    });
  });
});
