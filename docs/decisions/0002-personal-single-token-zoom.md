# 0002: Personal single-token zoom and character choices

Date: 2026-07-27

## Status

Accepted

## Context

Fitting padded bounds works well for multiple characters but can zoom too far
into a single token. Different users prefer different single-token scales.
Players who own several tokens also need to choose one without losing the
existing all-owned-characters action.

## Decision

- Store `singleTokenZoom` beside `autoFocusEnabled` in the existing namespaced
  player metadata object. It defaults to `0.5` and is constrained to `0.1–2`.
- When exactly one character is targeted, construct viewport-sized scene bounds
  centered on the token at the preferred scale and animate to those bounds.
- Continue using padded combined item bounds whenever multiple characters are
  targeted.
- Apply the receiving player's preference to automatic and remote player
  focus. Apply the GM's preference to GM-local focus.
- Show visible owned tokens by token name in a player's **My characters** list
  only when the player owns more than one. Keep **Focus me now** as the
  all-owned-characters action.
- Label GM party rows with Owlbear player names rather than character names.

## Consequences

Personal controls survive popover closure and scene changes without adding
room-level settings. Remote commands remain independent of the GM's zoom
preference, and multi-token framing behavior is unchanged.
