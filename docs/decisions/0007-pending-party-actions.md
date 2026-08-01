# 0007: Scene-persistent pending Party actions

Date: 2026-08-01

## Context

Remote Focus and Highlight actions cannot help players find hidden items. GMs
need to prepare those actions before revealing an item without losing the
selected target, action, or visual confirmation of the pending work.

## Decision

- Queue Focus for Party or Highlight for Party when any selected target is
  hidden, and execute the group only after every original target is visible.
- Store validated groups in scene metadata and mirror group/action markers onto
  their items. Pending state therefore survives panel reloads and GM reconnects
  but does not cross scene boundaries.
- Require target membership to be disjoint across all pending groups. Reject a
  new request in full when any target already belongs to another group.
- Cancel an entire group through any member. Remove a group if one of its
  targets is deleted.
- Use Party membership at execution time. Retain ready groups while player
  actions are disabled or no non-GM player is connected.
- Elect one connected GM background deterministically to broadcast ready
  groups, with a stable request ID as receiver-side duplicate protection.
- Revalidate visibility on the elected GM immediately before broadcasting.
  Receiving clients require the complete target set but do not reject a target
  merely because their local visibility replica lags behind the broadcast.
- Keep for Me actions immediate and client-local. Use fixed orange UI markers
  and GM-only configuration, conflict, and cancellation notifications.

## Consequences

Multiple disjoint actions may wait independently. All GM panels reflect shared
pending state, while affected players receive the existing authenticated action
and toast only when the action actually executes.
