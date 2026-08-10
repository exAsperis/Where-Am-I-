import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";

import {
  parseReleaseChannel,
  transformManifest,
} from "./build/release-channel";

const base = process.env.VITE_BASE_PATH ?? "/";
const releaseChannel = parseReleaseChannel(process.env.VITE_RELEASE_CHANNEL);

if (!base.startsWith("/") || !base.endsWith("/")) {
  throw new Error("VITE_BASE_PATH must start and end with '/'.");
}

export default defineConfig({
  base,
  plugins: [
    {
      name: "release-channel-manifest",
      async closeBundle() {
        const manifestPath = resolve(import.meta.dirname, "dist/manifest.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        const output = transformManifest(manifest, releaseChannel);
        await writeFile(manifestPath, `${JSON.stringify(output, null, 2)}\n`);
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "main.html"),
        background: resolve(import.meta.dirname, "background.html"),
      },
    },
  },
});
