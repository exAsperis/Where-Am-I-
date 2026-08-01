import type { Player } from "@owlbear-rodeo/sdk";

import { FOCUS_COMMAND_MAX_AGE_MS, MAX_RECENT_REQUEST_IDS } from "./constants";

export type TargetAction = "FOCUS" | "HIGHLIGHT";
export type TargetRecipient =
  { scope: "PLAYER"; playerId: string } | { scope: "PARTY" };

export interface TargetActionCommand {
  type: "TARGET_ACTION";
  action: TargetAction;
  recipient: TargetRecipient;
  targetCharacterIds: string[];
  includeHidden: boolean;
  targetMode?: "CHARACTERS" | "ALL_ITEMS";
  requireVisible?: boolean;
  actorName?: string;
  targetLabel?: string;
  requestId: string;
  sentAt: number;
}

export interface LegacyFocusCommand {
  type: "FOCUS_OWNED_CHARACTERS";
  targetPlayerId: string;
  targetCharacterId?: string;
  requestId: string;
  sentAt: number;
}

export type RoutedTargetAction =
  | { kind: "ACTION"; command: TargetActionCommand }
  | { kind: "LEGACY_FOCUS"; command: LegacyFocusCommand };

export type TargetActionDecision =
  | { execute: true; routed: RoutedTargetAction }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasEnvelope(value: Record<string, unknown>): boolean {
  return (
    typeof value.requestId === "string" &&
    value.requestId.length > 0 &&
    typeof value.sentAt === "number" &&
    Number.isFinite(value.sentAt)
  );
}

export function isTargetActionCommand(
  value: unknown,
): value is TargetActionCommand {
  if (!isRecord(value) || !hasEnvelope(value)) return false;
  const recipient = value.recipient;
  return (
    value.type === "TARGET_ACTION" &&
    (value.action === "FOCUS" || value.action === "HIGHLIGHT") &&
    isRecord(recipient) &&
    (recipient.scope === "PARTY" ||
      (recipient.scope === "PLAYER" &&
        typeof recipient.playerId === "string" &&
        recipient.playerId.length > 0)) &&
    Array.isArray(value.targetCharacterIds) &&
    value.targetCharacterIds.length > 0 &&
    value.targetCharacterIds.every(
      (id) => typeof id === "string" && id.length > 0,
    ) &&
    typeof value.includeHidden === "boolean" &&
    (value.targetMode === undefined ||
      value.targetMode === "CHARACTERS" ||
      value.targetMode === "ALL_ITEMS") &&
    (value.requireVisible === undefined ||
      typeof value.requireVisible === "boolean") &&
    (value.actorName === undefined ||
      (typeof value.actorName === "string" && value.actorName.length > 0)) &&
    (value.targetLabel === undefined ||
      (typeof value.targetLabel === "string" && value.targetLabel.length > 0))
  );
}

export function isLegacyFocusCommand(
  value: unknown,
): value is LegacyFocusCommand {
  if (!isRecord(value) || !hasEnvelope(value)) return false;
  return (
    value.type === "FOCUS_OWNED_CHARACTERS" &&
    typeof value.targetPlayerId === "string" &&
    value.targetPlayerId.length > 0 &&
    (value.targetCharacterId === undefined ||
      (typeof value.targetCharacterId === "string" &&
        value.targetCharacterId.length > 0))
  );
}

export class RecentRequestIds {
  readonly #ids = new Set<string>();
  has(id: string): boolean {
    return this.#ids.has(id);
  }
  add(id: string): void {
    this.#ids.add(id);
    if (this.#ids.size > MAX_RECENT_REQUEST_IDS) {
      const oldest = this.#ids.values().next().value;
      if (oldest !== undefined) this.#ids.delete(oldest);
    }
  }
}

export function routeTargetAction(options: {
  data: unknown;
  currentPlayerId: string;
  senderConnectionId: string;
  connectedPlayers: readonly Pick<Player, "connectionId" | "role">[];
  globalEnabled: boolean;
  recentRequestIds: RecentRequestIds;
  now?: number;
}): TargetActionDecision {
  const {
    data,
    currentPlayerId,
    senderConnectionId,
    connectedPlayers,
    globalEnabled,
    recentRequestIds,
    now = Date.now(),
  } = options;
  const routed: RoutedTargetAction | undefined = isTargetActionCommand(data)
    ? { kind: "ACTION", command: data }
    : isLegacyFocusCommand(data)
      ? { kind: "LEGACY_FOCUS", command: data }
      : undefined;
  if (!routed) return { execute: false, reason: "MALFORMED" };
  const command = routed.command;
  const intended =
    routed.kind === "LEGACY_FOCUS"
      ? routed.command.targetPlayerId === currentPlayerId
      : routed.command.recipient.scope === "PARTY" ||
        routed.command.recipient.playerId === currentPlayerId;
  if (!intended) return { execute: false, reason: "WRONG_TARGET" };
  if (!globalEnabled) return { execute: false, reason: "DISABLED" };
  if (
    !connectedPlayers.some(
      (player) =>
        player.connectionId === senderConnectionId && player.role === "GM",
    )
  ) {
    return { execute: false, reason: "UNAUTHORIZED" };
  }
  if (
    command.sentAt > now + 5_000 ||
    now - command.sentAt > FOCUS_COMMAND_MAX_AGE_MS
  ) {
    return { execute: false, reason: "STALE" };
  }
  if (recentRequestIds.has(command.requestId)) {
    return { execute: false, reason: "DUPLICATE" };
  }
  recentRequestIds.add(command.requestId);
  return { execute: true, routed };
}

export function createTargetActionCommand(
  action: TargetAction,
  recipient: TargetRecipient,
  targetCharacterIds: readonly string[],
  includeHidden = false,
  targetMode: "CHARACTERS" | "ALL_ITEMS" = "CHARACTERS",
  actorName?: string,
  targetLabel?: string,
  options?: {
    requestId?: string;
    sentAt?: number;
    requireVisible?: boolean;
  },
): TargetActionCommand {
  return {
    type: "TARGET_ACTION",
    action,
    recipient,
    targetCharacterIds: [...targetCharacterIds],
    includeHidden,
    targetMode,
    ...(options?.requireVisible ? { requireVisible: true } : {}),
    ...(actorName ? { actorName } : {}),
    ...(targetLabel ? { targetLabel } : {}),
    requestId: options?.requestId ?? crypto.randomUUID(),
    sentAt: options?.sentAt ?? Date.now(),
  };
}

export function createLegacyFocusCommand(
  targetPlayerId: string,
  requestId: string,
  targetCharacterId?: string,
): LegacyFocusCommand {
  return {
    type: "FOCUS_OWNED_CHARACTERS",
    targetPlayerId,
    ...(targetCharacterId ? { targetCharacterId } : {}),
    requestId,
    sentAt: Date.now(),
  };
}

export function formatTargetActionToast(
  command: TargetActionCommand,
): string | undefined {
  if (!command.actorName || !command.targetLabel) return undefined;
  const verb = command.action === "FOCUS" ? "focused" : "highlighted";
  const audience =
    command.recipient.scope === "PARTY" ? "for the party" : "for you";
  return `${command.actorName} ${verb} ${command.targetLabel} ${audience}.`;
}
