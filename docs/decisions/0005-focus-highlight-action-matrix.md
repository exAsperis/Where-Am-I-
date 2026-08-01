# 0005: Focus and highlight action matrix

Date: 2026-08-01

## Context

GMs need to act locally, on a character's controlling player, or on every
non-GM client. Viewport movement and visual emphasis must also be independently
selectable without crowding each player and character tile.

## Decision

- Use **Focus** for viewport movement and **Highlight** for the temporary local
  ring animation.
- Give GM player and character tiles Focus and Highlight menus with Me, Player,
  and Party recipients. Party and all-character controls omit Player.
- Send explicit token IDs in authenticated GM commands. Receivers re-fetch the
  IDs and validate Character layer and visibility before acting.
- Explicit Highlight always displays. Highlights accompanying automatic or
  requested Focus respect the viewing client's saved preference and start 500
  milliseconds after viewport movement completes.
- Register GM-only background context-menu actions for Focus for Party and
  Highlight for Party. Context targets preserve exact selected item IDs and may
  include any item layer.
- Treat explicit GM panel targets as the exact GM-resolved item set on receiving
  clients. Do not reapply client-local Character visibility classification;
  sender-side player and party selection already enforces those policies.
- Relay panel actions locally through the persistent GM background before the
  remote broadcast so receivers authenticate the same GM connection used by
  background context-menu actions.
- Use a dedicated target-action channel while continuing to receive the legacy
  focus channel. Send a same-request-ID legacy fallback for single-player Focus
  so mixed-version clients execute it exactly once. Dual-write the legacy
  highlight-preference field during the compatibility transition.

## Consequences

Every non-GM client targeted through Party sees the same selected characters.
Focus and Highlight remain client-local, while Show/Hide and Move remain the
only shared scene mutations.
