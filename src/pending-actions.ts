import OBR, { type Item, type Metadata, type Player } from "@owlbear-rodeo/sdk";

import {
  PENDING_FOCUS_PARTY_ITEM_METADATA_KEY,
  PENDING_HIGHLIGHT_PARTY_ITEM_METADATA_KEY,
  PENDING_PARTY_ACTION_ITEM_METADATA_KEY,
  PENDING_PARTY_ACTIONS_METADATA_KEY,
  PENDING_PARTY_GROUP_ITEM_METADATA_KEY,
} from "./constants";
import type { TargetAction } from "./remote-actions";

export interface PendingPartyAction {
  id: string;
  executionRequestId: string;
  action: TargetAction;
  targetIds: string[];
  targetMode: "CHARACTERS" | "ALL_ITEMS";
  actorName: string;
  targetLabel: string;
  createdAt: number;
}

export type QueuePendingPartyActionResult =
  | { kind: "READY"; targetIds: string[] }
  | { kind: "QUEUED"; pending: PendingPartyAction }
  | {
      kind: "CONFLICT";
      item: Item;
      pending: PendingPartyAction;
    }
  | { kind: "MISSING" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPendingPartyAction(value: unknown): value is PendingPartyAction {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.executionRequestId === "string" &&
    value.executionRequestId.length > 0 &&
    (value.action === "FOCUS" || value.action === "HIGHLIGHT") &&
    Array.isArray(value.targetIds) &&
    value.targetIds.length > 0 &&
    value.targetIds.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(value.targetIds).size === value.targetIds.length &&
    (value.targetMode === "CHARACTERS" || value.targetMode === "ALL_ITEMS") &&
    typeof value.actorName === "string" &&
    value.actorName.length > 0 &&
    typeof value.targetLabel === "string" &&
    value.targetLabel.length > 0 &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt)
  );
}

export function readPendingPartyActions(
  metadata: Metadata,
): PendingPartyAction[] {
  const value = metadata[PENDING_PARTY_ACTIONS_METADATA_KEY];
  if (!Array.isArray(value)) return [];
  const actions = value.filter(isPendingPartyAction);
  const occupied = new Set<string>();
  return actions.filter((action) => {
    if (action.targetIds.some((id) => occupied.has(id))) return false;
    action.targetIds.forEach((id) => occupied.add(id));
    return true;
  });
}

export function findPendingActionForItem(
  actions: readonly PendingPartyAction[],
  itemId: string,
): PendingPartyAction | undefined {
  return actions.find((action) => action.targetIds.includes(itemId));
}

export function findPendingConflict(
  actions: readonly PendingPartyAction[],
  targetIds: readonly string[],
): PendingPartyAction | undefined {
  const ids = new Set(targetIds);
  return actions.find((action) => action.targetIds.some((id) => ids.has(id)));
}

export function getPendingTargetState(
  pending: PendingPartyAction,
  items: readonly Pick<Item, "id" | "visible">[],
): "MISSING" | "HIDDEN" | "READY" {
  const byId = new Map(items.map((item) => [item.id, item]));
  if (pending.targetIds.some((id) => !byId.has(id))) return "MISSING";
  return pending.targetIds.every((id) => byId.get(id)?.visible)
    ? "READY"
    : "HIDDEN";
}

export function isElectedPendingExecutor(
  currentConnectionId: string,
  players: readonly Pick<Player, "connectionId" | "role">[],
): boolean {
  const gmConnections = [
    currentConnectionId,
    ...players
      .filter((player) => player.role === "GM")
      .map((player) => player.connectionId),
  ]
    .filter((id, index, ids) => id.length > 0 && ids.indexOf(id) === index)
    .sort();
  return gmConnections[0] === currentConnectionId;
}

export function pendingMarkerUpdate(
  pending: PendingPartyAction | undefined,
): Metadata {
  return {
    [PENDING_PARTY_GROUP_ITEM_METADATA_KEY]: pending?.id ?? null,
    [PENDING_PARTY_ACTION_ITEM_METADATA_KEY]: pending?.action ?? null,
    [PENDING_FOCUS_PARTY_ITEM_METADATA_KEY]:
      pending?.action === "FOCUS" ? true : null,
    [PENDING_HIGHLIGHT_PARTY_ITEM_METADATA_KEY]:
      pending?.action === "HIGHLIGHT" ? true : null,
  };
}

async function updateMarkers(
  itemIds: readonly string[],
  pending: PendingPartyAction | undefined,
): Promise<void> {
  if (itemIds.length === 0) return;
  await OBR.scene.items.updateItems([...itemIds], (items) => {
    for (const item of items) {
      item.metadata = { ...item.metadata, ...pendingMarkerUpdate(pending) };
    }
  });
}

export async function getPendingPartyActions(): Promise<PendingPartyAction[]> {
  if (!(await OBR.scene.isReady())) return [];
  return readPendingPartyActions(await OBR.scene.getMetadata());
}

export async function synchronizePendingPartyMarkers(
  actions: readonly PendingPartyAction[],
): Promise<void> {
  if (!(await OBR.scene.isReady())) return;
  const items = await OBR.scene.items.getItems();
  const pendingByItem = new Map<string, PendingPartyAction>();
  for (const action of actions) {
    for (const id of action.targetIds) pendingByItem.set(id, action);
  }
  const changedIds = items
    .filter((item) => {
      const expected = pendingMarkerUpdate(pendingByItem.get(item.id));
      return Object.entries(expected).some(
        ([key, value]) => (item.metadata[key] ?? null) !== value,
      );
    })
    .map((item) => item.id);
  if (changedIds.length === 0) return;
  await OBR.scene.items.updateItems(changedIds, (changed) => {
    for (const item of changed) {
      item.metadata = {
        ...item.metadata,
        ...pendingMarkerUpdate(pendingByItem.get(item.id)),
      };
    }
  });
}

export async function queuePendingPartyAction(options: {
  action: TargetAction;
  targetIds: readonly string[];
  targetMode: "CHARACTERS" | "ALL_ITEMS";
  actorName: string;
  targetLabel: string;
}): Promise<QueuePendingPartyActionResult> {
  const targetIds = [...new Set(options.targetIds)];
  if (targetIds.length === 0 || !(await OBR.scene.isReady())) {
    return { kind: "MISSING" };
  }
  const [items, metadata] = await Promise.all([
    OBR.scene.items.getItems(targetIds),
    OBR.scene.getMetadata(),
  ]);
  if (items.length !== targetIds.length) return { kind: "MISSING" };
  const existing = readPendingPartyActions(metadata);
  const conflict = findPendingConflict(existing, targetIds);
  if (conflict) {
    const conflictId = conflict.targetIds.find((id) => targetIds.includes(id));
    const item = items.find((candidate) => candidate.id === conflictId);
    if (item) return { kind: "CONFLICT", item, pending: conflict };
    return { kind: "MISSING" };
  }
  if (items.every((item) => item.visible)) {
    return { kind: "READY", targetIds };
  }

  const pending: PendingPartyAction = {
    id: crypto.randomUUID(),
    executionRequestId: crypto.randomUUID(),
    action: options.action,
    targetIds,
    targetMode: options.targetMode,
    actorName: options.actorName,
    targetLabel: options.targetLabel,
    createdAt: Date.now(),
  };
  await OBR.scene.setMetadata({
    [PENDING_PARTY_ACTIONS_METADATA_KEY]: [...existing, pending],
  });
  try {
    await updateMarkers(targetIds, pending);
  } catch (error) {
    await OBR.scene.setMetadata({
      [PENDING_PARTY_ACTIONS_METADATA_KEY]: existing,
    });
    throw error;
  }
  return { kind: "QUEUED", pending };
}

export async function removePendingPartyActions(
  actionIds: readonly string[],
): Promise<PendingPartyAction[]> {
  const ids = new Set(actionIds);
  if (ids.size === 0 || !(await OBR.scene.isReady())) return [];
  const metadata = await OBR.scene.getMetadata();
  const existing = readPendingPartyActions(metadata);
  const removed = existing.filter((action) => ids.has(action.id));
  if (removed.length === 0) return [];
  await OBR.scene.setMetadata({
    [PENDING_PARTY_ACTIONS_METADATA_KEY]: existing.filter(
      (action) => !ids.has(action.id),
    ),
  });
  await updateMarkers(
    removed.flatMap((action) => action.targetIds),
    undefined,
  );
  return removed;
}

export async function cancelPendingPartyActionsForItems(
  action: TargetAction,
  itemIds: readonly string[],
): Promise<PendingPartyAction[]> {
  const ids = new Set(itemIds);
  const existing = await getPendingPartyActions();
  return removePendingPartyActions(
    existing
      .filter(
        (pending) =>
          pending.action === action &&
          pending.targetIds.some((id) => ids.has(id)),
      )
      .map((pending) => pending.id),
  );
}

export function formatPendingConfiguredToast(
  pending: PendingPartyAction,
): string {
  const noun = pending.targetIds.length === 1 ? "target is" : "targets are";
  return `${pending.action === "FOCUS" ? "Focus" : "Highlight"} for Party is pending for ${pending.targetLabel} until the ${noun} visible.`;
}

export function formatPendingConflictToast(
  requestedAction: TargetAction,
  item: Pick<Item, "name">,
  existing: PendingPartyAction,
): string {
  const label = item.name.trim() || "This item";
  return `Can’t queue ${requestedAction === "FOCUS" ? "Focus" : "Highlight"}: ${label} already belongs to a pending ${existing.action === "FOCUS" ? "Focus" : "Highlight"} for Party action.`;
}

export function formatPendingCanceledToast(
  pending: PendingPartyAction,
): string {
  return `Pending ${pending.action === "FOCUS" ? "Focus" : "Highlight"} for Party canceled for ${pending.targetLabel}.`;
}
