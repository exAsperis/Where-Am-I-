import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(await readFile("public/manifest.json", "utf8"));
const storeSource = await readFile("public/store.md", "utf8");
const versionSource = await readFile("src/version.ts", "utf8");

const versionMatch = versionSource.match(
  /RELEASE_VERSION\s*=\s*["']([^"']+)["']/,
);

if (!versionMatch) {
  throw new Error("Could not read RELEASE_VERSION from src/version.ts");
}

const expected = packageJson.version;
const storeImageMatch = storeSource.match(/^image:\s*(\S+)\s*$/m);
const storeIconMatch = storeSource.match(/^icon:\s*(\S+)\s*$/m);
const storeVersionedAssetUrls = [
  ...storeSource.matchAll(/https:\/\/\S+\?v=[^\s)]+/g),
].map((match) => match[0]);

if (!storeImageMatch || !storeIconMatch) {
  throw new Error("Could not read store image URLs from public/store.md");
}

const versions = new Map([
  ["package.json", expected],
  ["public/manifest.json", manifest.version],
  [
    "manifest popover query",
    new URL(manifest.action.popover, "https://local").searchParams.get("v"),
  ],
  [
    "manifest background query",
    new URL(manifest.background_url, "https://local").searchParams.get("v"),
  ],
  [
    "manifest icon query",
    new URL(manifest.icon, "https://local").searchParams.get("v"),
  ],
  [
    "manifest action icon query",
    new URL(manifest.action.icon, "https://local").searchParams.get("v"),
  ],
  [
    "store hero query",
    new URL(storeImageMatch[1], "https://local").searchParams.get("v"),
  ],
  [
    "store icon query",
    new URL(storeIconMatch[1], "https://local").searchParams.get("v"),
  ],
  ["src/version.ts", versionMatch[1]],
]);

for (const [index, assetUrl] of storeVersionedAssetUrls.entries()) {
  versions.set(
    `store versioned asset query ${index + 1}`,
    new URL(assetUrl).searchParams.get("v"),
  );
}

const drift = [...versions].filter(([, version]) => version !== expected);
if (drift.length > 0) {
  throw new Error(
    `Release version drift (expected ${expected}): ${drift
      .map(([location, version]) => `${location}=${String(version)}`)
      .join(", ")}`,
  );
}

console.log(`Release versions synchronized at ${expected}.`);
