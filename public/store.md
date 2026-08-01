---
title: Where am I?
description: Focus and highlight characters in Owlbear Rodeo.
author: ex Asperis
image: https://exasperis.github.io/Where-Am-I-/store-hero.svg?v=0.6.4
icon: https://exasperis.github.io/Where-Am-I-/icon.svg?v=0.6.4
tags:
  - automation
manifest: https://exasperis.github.io/Where-Am-I-/manifest.json
learn-more: https://github.com/exAsperis/Where-Am-I-
---

# Where am I?

Where am I? keeps players oriented by focusing their visible, player-owned
Character-layer tokens and moving only their local Owlbear Rodeo viewport.

![Where am I? extension overview](https://exasperis.github.io/Where-Am-I-/store-hero.svg?v=0.6.4)

## For players

- Automatically focus your character when joining or changing scenes.
- Focus all of your characters together whenever you choose.
- Pick one named character from your personal list when you own several.
- Set and save your preferred single-character zoom.
- Optionally show a private orange highlight when characters are focused.
- Collapse Settings and retain its state for the next time the panel opens.

## For GMs

- Enable or disable player-facing behavior for the room.
- Focus or highlight a player or character for the GM, controlling player, or
  the whole non-GM party.
- Focus or highlight the whole party locally or for every player.
- Expand all scene character tokens to focus, highlight, show or hide, and move
  them.
- Focus or highlight any context-menu selection for the whole party.
- Keep personal zoom and highlight preferences.

Only visible items on the Character layer are included. Ownership is determined
by the player who created the token. When a player owns multiple characters,
Where am I? frames all of them together unless a specific named token is chosen.

## Privacy

Where am I? has no backend, accounts, analytics, or external data storage.
Preferences use namespaced Owlbear Rodeo player metadata, the global enablement
setting uses room metadata, and remote GM requests use Owlbear Rodeo broadcasts.
Highlights are temporary client-local scene items, so each recipient sees only
their own highlight animation.

## Support

For help, bug reports, or feature requests, open an issue on the
[Where am I? GitHub repository](https://github.com/exAsperis/Where-Am-I-/issues).
