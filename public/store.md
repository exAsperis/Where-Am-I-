---
title: Where am I?
description: Find and frame player-owned characters in Owlbear Rodeo.
author: ex Asperis
image: https://exasperis.github.io/Where-Am-I-/store-hero.svg?v=0.4.0
icon: https://exasperis.github.io/Where-Am-I-/icon.svg?v=0.4.0
tags:
  - automation
manifest: https://exasperis.github.io/Where-Am-I-/manifest.json
learn-more: https://github.com/exAsperis/Where-Am-I-
---

# Where am I?

Where am I? keeps players oriented by finding their visible, player-owned
Character-layer tokens and moving only their local Owlbear Rodeo viewport.

![Where am I? extension overview](https://exasperis.github.io/Where-Am-I-/store-hero.svg?v=0.4.0)

## For players

- Automatically focus your character when joining or changing scenes.
- Find all of your characters together whenever you choose.
- Pick one named character from your personal list when you own several.
- Set and save your preferred single-character zoom.
- Optionally show a private orange target animation when characters are found.

## For GMs

- Enable or disable player-facing behavior for the room.
- Send a player to their character without moving anyone else's viewport.
- Expand multi-character players to send or view one named character.
- View one player's characters or frame the whole party locally.
- Keep personal zoom and target-indicator preferences.

Only visible items on the Character layer are included. Ownership is determined
by the player who created the token. When a player owns multiple characters,
Where am I? frames all of them together unless a specific named token is chosen.

## Privacy

Where am I? has no backend, accounts, analytics, or external data storage.
Preferences use namespaced Owlbear Rodeo player metadata, the global enablement
setting uses room metadata, and remote GM requests use Owlbear Rodeo broadcasts.
Target indicators are temporary client-local scene items, so only the person
whose viewport is moving can see them.

## Support

For help, bug reports, or feature requests, open an issue on the
[Where am I? GitHub repository](https://github.com/exAsperis/Where-Am-I-/issues).
