# 0003: Client-local highlights and targeted remote focus

Date: 2026-07-27

## Context

Viewport movement can be hard to notice on a large scene, especially when a
focus operation includes several characters. Shared scene items would expose
personal UI feedback to every participant and would unnecessarily modify shared
scene state. GMs also need to focus or remotely send one character belonging to
a player who controls several.

## Decision

Where am I? renders target animations as temporary `OBR.scene.local` circle
items. Each client applies its own player-metadata preference, and the
highlights are created, animated, and removed only on that client.

Remote focus commands may include an optional target character ID. Receivers
re-fetch the target and require it to be visible, on the Character layer, and
owned by the command's target player. Commands without an ID retain the
existing all-owned-characters behavior.

## Consequences

- Highlights are private and never alter shared scene content.
- GM-sent Focus respects the receiving player's highlight preference.
- Stable local shape APIs provide animation without relying on experimental
  effects.
- Animation failures can be isolated from viewport focus and cleaned up.
- Targeted commands require receiver-side ownership validation rather than
  trusting the sender's item ID.
