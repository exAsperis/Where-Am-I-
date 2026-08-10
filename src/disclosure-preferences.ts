export const ROOM_SETTINGS_EXPANDED_KEY =
  "com.ex-asperis.where-am-i.room-settings-expanded";
export const MY_SETTINGS_EXPANDED_KEY =
  "com.ex-asperis.where-am-i.my-settings-expanded";

type StorageProvider = () => Pick<Storage, "getItem" | "setItem">;

const browserStorage: StorageProvider = () => window.localStorage;

export function readDisclosurePreference(
  key: string,
  getStorage: StorageProvider = browserStorage,
): boolean {
  try {
    const value = getStorage().getItem(key);
    return value === "false" ? false : true;
  } catch {
    return true;
  }
}

export function writeDisclosurePreference(
  key: string,
  expanded: boolean,
  getStorage: StorageProvider = browserStorage,
): void {
  try {
    getStorage().setItem(key, String(expanded));
  } catch {
    // Disclosure preferences are optional and must never block the settings UI.
  }
}
