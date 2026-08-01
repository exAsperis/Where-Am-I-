# 0001: Client-local focus architecture

Date: 2026-07-27

## Status

Accepted

## Context

Where am I? must automatically frame a player’s owned characters without
requiring its action popover to remain open. Local player actions must never
move another viewport, while a GM needs an explicit way to request a focus in a
specific player’s connected clients. Commands are ephemeral and must be
authorized using the sending Owlbear connection.

## Decision

- Run scene-readiness automation and broadcast reception in the extension
  background page. The popover renders state and initiates explicit actions.
- Keep character filtering, padding, and viewport focus in shared modules used
  by both entry points.
- Store `{ autoFocusEnabled }` in namespaced player metadata and
  `{ globalEnabled }` in namespaced room metadata. Both default to `true`.
- Send remote focus requests over one namespaced Owlbear broadcast channel,
  targeted by stable player ID and carrying a unique request ID plus timestamp.
- On every receiving player connection, require a current connected GM whose
  `connectionId` matches the sender, reject stale or duplicate commands, and
  re-check the room setting before moving the local viewport.
- Treat `createdUserId` on visible `CHARACTER`-layer items as the sole ownership
  rule. Frame all qualifying items together.
- Use Owlbear Rodeo's `CHARACTER_OWNER_ONLY` room permission only to tailor
  setup guidance. Eligibility remains based on `createdUserId`, so tokens a
  player created work even when Owner Only is disabled.
- Disable actions before execution when their scene, target, or recipient is
  unavailable, and show one reason-specific inline hint using Owlbear Rodeo's
  Player Permissions and Owner-menu terminology.

## Consequences

Each background instance owns only its local viewport. Two connections using
the same stable player ID both respond to one authorized GM command, while the
GM sees one logical player row. The system needs no backend, command
persistence, join detection by the GM, polling, or continuously following
camera.
