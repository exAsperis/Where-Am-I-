import { RELEASE_VERSION } from "./version";

export type ReleaseChannel = "production" | "beta";

const configuredChannel = import.meta.env.VITE_RELEASE_CHANNEL ?? "production";

if (configuredChannel !== "production" && configuredChannel !== "beta") {
  throw new Error(`Unsupported release channel: ${configuredChannel}`);
}

export const RELEASE_CHANNEL: ReleaseChannel = configuredChannel;
export const DISPLAY_NAME =
  RELEASE_CHANNEL === "beta" ? "Where am I? (beta)" : "Where am I?";
export const DISPLAY_VERSION =
  RELEASE_CHANNEL === "beta" ? `${RELEASE_VERSION}-beta` : RELEASE_VERSION;
