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
  requested Focus respect the viewing client's saved preference.
- Keep accepting legacy owned-character focus commands and dual-write the
  legacy highlight-preference field during the compatibility transition.

## Consequences

Every non-GM client targeted through Party sees the same selected characters.
Focus and Highlight remain client-local, while Show/Hide and Move remain the
only shared scene mutations.
