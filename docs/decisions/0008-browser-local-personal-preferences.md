# 0008: Browser-local personal preferences

## Status

Accepted

## Context

Owlbear player metadata belongs to the live player connection. A page refresh
creates a new connection, so personal feature settings reverted to defaults
despite appearing to save successfully.

## Decision

- Store personal preferences in extension-origin browser local storage,
  namespaced by the Owlbear player ID.
- On the first load without browser-local preferences, import valid current or
  legacy player metadata so an active session can retain its existing values.
- Keep room-wide settings in Owlbear room metadata.

## Consequences

Personal preferences survive extension and Owlbear page refreshes in the same
browser profile and remain private to that browser. They do not synchronize
across browsers or devices. If browser storage is unavailable, current player
metadata supplies session defaults but persistent updates report an error.
