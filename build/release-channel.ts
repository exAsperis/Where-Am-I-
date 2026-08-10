export type ReleaseChannel = "production" | "beta";

interface ExtensionManifest {
  name: string;
  version: string;
  icon: string;
  action: {
    title: string;
    icon: string;
    popover: string;
  };
  background_url: string;
}

const PRODUCTION_ORIGIN = "https://exasperis.github.io/Where-Am-I-/";
const BETA_ORIGIN = "https://where-am-i-beta.ex-asperis.com/";

export function parseReleaseChannel(value: string | undefined): ReleaseChannel {
  const channel = value ?? "production";
  if (channel !== "production" && channel !== "beta") {
    throw new Error(`Unsupported VITE_RELEASE_CHANNEL: ${channel}`);
  }
  return channel;
}

export function transformManifest(
  source: ExtensionManifest,
  channel: ReleaseChannel,
): ExtensionManifest {
  if (channel === "production") return structuredClone(source);

  const version = `${source.version}-beta`;
  const transformUrl = (value: string): string => {
    const url = new URL(value.replace(PRODUCTION_ORIGIN, BETA_ORIGIN));
    url.searchParams.set("v", version);
    return url.toString();
  };

  return {
    ...structuredClone(source),
    name: "Where am I? (beta)",
    version,
    icon: transformUrl(source.icon),
    action: {
      ...source.action,
      title: "Where am I? (beta)",
      icon: transformUrl(source.action.icon),
      popover: transformUrl(source.action.popover),
    },
    background_url: transformUrl(source.background_url),
  };
}
