# 0006: Highlight color inheritance and remote feedback

Date: 2026-08-01

## Context

Players need personal control over highlight color while retaining a shared GM
default, and remote GM actions need visible confirmation on affected clients.
Multi-item focus must also honor the same zoom limit as a single character.

## Decision

- Store each player's Default or Custom color choice in player metadata.
- Store the shared GM Default or Custom color choice in room metadata under
  `com.ex-asperis.where-am-i/highlight-settings`, so every GM edits the same
  room setting without changing the legacy metadata namespace.
- Resolve Default to orange for a GM. Resolve a player's Default to the shared
  GM custom color when one exists, and to orange otherwise.
- Use the browser's native color input for Custom selection.
- Include the acting GM name and a concise target label in authenticated remote
  commands. After a successful action, each affected non-GM client displays one
  local informational toast.
- Cap multi-item focus bounds so the resulting viewport never zooms closer than
  the recipient's saved single-character zoom.

## Consequences

Player custom colors remain private preferences, while a room's GMs share one
default color. Older commands without descriptive fields remain valid but do
not produce the new descriptive toast. Highlight rendering and notifications
remain client-local.
