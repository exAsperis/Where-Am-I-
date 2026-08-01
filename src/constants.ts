export const EXTENSION_NAMESPACE = "com.ex-asperis.whereami";
export const LEGACY_EXTENSION_NAMESPACE = "io.github.exasperis.where-am-i";

export const PLAYER_SETTINGS_METADATA_KEY = `${EXTENSION_NAMESPACE}/player-settings`;
export const ROOM_SETTINGS_METADATA_KEY = `${EXTENSION_NAMESPACE}/room-settings`;
export const GM_HIGHLIGHT_SETTINGS_METADATA_KEY =
  "com.ex-asperis.where-am-i/highlight-settings";
export const LEGACY_PLAYER_SETTINGS_METADATA_KEY = `${LEGACY_EXTENSION_NAMESPACE}/player-settings`;
export const LEGACY_ROOM_SETTINGS_METADATA_KEY = `${LEGACY_EXTENSION_NAMESPACE}/room-settings`;
export const LEGACY_FOCUS_BROADCAST_CHANNEL = `${EXTENSION_NAMESPACE}/focus-command`;
export const TARGET_ACTION_BROADCAST_CHANNEL = `${EXTENSION_NAMESPACE}/target-action`;

export const DEFAULT_GLOBAL_ENABLED = true;
export const DEFAULT_PLAYER_AUTO_FOCUS_ENABLED = true;
export const DEFAULT_HIGHLIGHT_ENABLED = true;
export const DEFAULT_SETTINGS_EXPANDED = false;
export const DEFAULT_SINGLE_TOKEN_ZOOM = 0.5;
export const MIN_SINGLE_TOKEN_ZOOM = 0.1;
export const MAX_SINGLE_TOKEN_ZOOM = 2;

export const PLAYER_POPOVER_MIN_HEIGHT = 330;
export const PLAYER_POPOVER_MAX_HEIGHT = 700;
export const GM_POPOVER_MIN_HEIGHT = 300;
export const GM_POPOVER_MAX_HEIGHT = 860;
export const POPOVER_WIDTH = 360;

export const FOCUS_COMMAND_MAX_AGE_MS = 30_000;
export const MAX_RECENT_REQUEST_IDS = 100;

export const HIGHLIGHT_METADATA_KEY = `${EXTENSION_NAMESPACE}/highlight`;
export const HIGHLIGHT_COLOR = "#fa5300";
export const HIGHLIGHT_STROKE_WIDTH = 12;
export const HIGHLIGHT_INITIAL_SCALE = 20;
export const HIGHLIGHT_SHRINK_MS = 3_000;
export const HIGHLIGHT_FADE_MS = 2_000;
export const HIGHLIGHT_FRAME_MS = 50;
export const FOCUS_HIGHLIGHT_DELAY_MS = 500;

export const FOCUS_PARTY_CONTEXT_MENU_ID = `${EXTENSION_NAMESPACE}/focus-party`;
export const HIGHLIGHT_PARTY_CONTEXT_MENU_ID = `${EXTENSION_NAMESPACE}/highlight-party`;
