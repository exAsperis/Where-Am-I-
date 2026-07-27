import { describe, expect, it } from "vitest";

import {
  RecentRequestIds,
  createFocusCommand,
  isFocusCommand,
  routeFocusCommand,
  type FocusCommand,
} from "./remote-focus";

const now = 1_000_000;
const command: FocusCommand = {
  type: "FOCUS_OWNED_CHARACTERS",
  targetPlayerId: "player-1",
  requestId: "request-1",
  sentAt: now,
};
const connectedPlayers = [
  { connectionId: "gm-connection", role: "GM" as const },
  { connectionId: "player-connection", role: "PLAYER" as const },
];

function route(
  overrides: Partial<Parameters<typeof routeFocusCommand>[0]> = {},
) {
  return routeFocusCommand({
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

describe("focus command validation and routing", () => {
  it("validates the complete typed message shape", () => {
    expect(isFocusCommand(command)).toBe(true);
    expect(isFocusCommand({ ...command, requestId: 17 })).toBe(false);
    expect(isFocusCommand({ ...command, sentAt: Number.NaN })).toBe(false);
    expect(isFocusCommand(null)).toBe(false);
    expect(
      isFocusCommand({ ...command, targetCharacterId: "character-1" }),
    ).toBe(true);
    expect(isFocusCommand({ ...command, targetCharacterId: "" })).toBe(false);
    expect(isFocusCommand({ ...command, targetCharacterId: 17 })).toBe(false);
  });

  it("creates all-character and specific-character commands", () => {
    expect(createFocusCommand("player-1")).not.toHaveProperty(
      "targetCharacterId",
    );
    expect(createFocusCommand("player-1", "character-1")).toMatchObject({
      type: "FOCUS_OWNED_CHARACTERS",
      targetPlayerId: "player-1",
      targetCharacterId: "character-1",
    });
  });

  it("accepts a fresh command for this player from a connected GM", () => {
    expect(route()).toEqual({ execute: true, command });
  });

  it("rejects a command intended for another player", () => {
    expect(route({ currentPlayerId: "player-2" })).toEqual({
      execute: false,
      reason: "WRONG_TARGET",
    });
  });

  it("rejects a command not sent by a currently connected GM", () => {
    expect(route({ senderConnectionId: "player-connection" })).toEqual({
      execute: false,
      reason: "UNAUTHORIZED",
    });
    expect(route({ senderConnectionId: "departed-gm" })).toEqual({
      execute: false,
      reason: "UNAUTHORIZED",
    });
  });

  it("rejects remote commands while globally disabled", () => {
    expect(route({ globalEnabled: false })).toEqual({
      execute: false,
      reason: "DISABLED",
    });
  });

  it("rejects stale commands", () => {
    expect(route({ data: { ...command, sentAt: now - 30_001 } })).toEqual({
      execute: false,
      reason: "STALE",
    });
  });

  it("suppresses duplicate request IDs", () => {
    const recentRequestIds = new RecentRequestIds();
    expect(route({ recentRequestIds }).execute).toBe(true);
    expect(route({ recentRequestIds })).toEqual({
      execute: false,
      reason: "DUPLICATE",
    });
  });
});
