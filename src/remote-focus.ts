import type { Player } from "@owlbear-rodeo/sdk";

import { FOCUS_COMMAND_MAX_AGE_MS, MAX_RECENT_REQUEST_IDS } from "./constants";

export interface FocusCommand {
  type: "FOCUS_OWNED_CHARACTERS";
  targetPlayerId: string;
  requestId: string;
  sentAt: number;
}

export type FocusCommandDecision =
  | { execute: true; command: FocusCommand }
  | {
      execute: false;
      reason:
        | "MALFORMED"
        | "WRONG_TARGET"
        | "DISABLED"
        | "UNAUTHORIZED"
        | "STALE"
        | "DUPLICATE";
    };

export function isFocusCommand(value: unknown): value is FocusCommand {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const command = value as Record<string, unknown>;
  return (
    command.type === "FOCUS_OWNED_CHARACTERS" &&
    typeof command.targetPlayerId === "string" &&
    command.targetPlayerId.length > 0 &&
    typeof command.requestId === "string" &&
    command.requestId.length > 0 &&
    typeof command.sentAt === "number" &&
    Number.isFinite(command.sentAt)
  );
}

export class RecentRequestIds {
  readonly #ids = new Set<string>();

  has(requestId: string): boolean {
    return this.#ids.has(requestId);
  }

  add(requestId: string): void {
    this.#ids.add(requestId);
    if (this.#ids.size > MAX_RECENT_REQUEST_IDS) {
      const oldest = this.#ids.values().next().value;
      if (oldest !== undefined) {
        this.#ids.delete(oldest);
      }
    }
  }
}

export function routeFocusCommand(options: {
  data: unknown;
  currentPlayerId: string;
  senderConnectionId: string;
  connectedPlayers: readonly Pick<Player, "connectionId" | "role">[];
  globalEnabled: boolean;
  recentRequestIds: RecentRequestIds;
  now?: number;
}): FocusCommandDecision {
  const {
    data,
    currentPlayerId,
    senderConnectionId,
    connectedPlayers,
    globalEnabled,
    recentRequestIds,
    now = Date.now(),
  } = options;

  if (!isFocusCommand(data)) {
    return { execute: false, reason: "MALFORMED" };
  }
  if (data.targetPlayerId !== currentPlayerId) {
    return { execute: false, reason: "WRONG_TARGET" };
  }
  if (!globalEnabled) {
    return { execute: false, reason: "DISABLED" };
  }
  if (
    !connectedPlayers.some(
      (player) =>
        player.connectionId === senderConnectionId && player.role === "GM",
    )
  ) {
    return { execute: false, reason: "UNAUTHORIZED" };
  }
  if (
    data.sentAt > now + 5_000 ||
    now - data.sentAt > FOCUS_COMMAND_MAX_AGE_MS
  ) {
    return { execute: false, reason: "STALE" };
  }
  if (recentRequestIds.has(data.requestId)) {
    return { execute: false, reason: "DUPLICATE" };
  }

  recentRequestIds.add(data.requestId);
  return { execute: true, command: data };
}

export function createFocusCommand(targetPlayerId: string): FocusCommand {
  return {
    type: "FOCUS_OWNED_CHARACTERS",
    targetPlayerId,
    requestId: crypto.randomUUID(),
    sentAt: Date.now(),
  };
}
