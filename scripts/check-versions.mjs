import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(await readFile("public/manifest.json", "utf8"));
const versionSource = await readFile("src/version.ts", "utf8");

const versionMatch = versionSource.match(
  /RELEASE_VERSION\s*=\s*["']([^"']+)["']/,
);

if (!versionMatch) {
  throw new Error("Could not read RELEASE_VERSION from src/version.ts");
}

const expected = packageJson.version;
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
  ["src/version.ts", versionMatch[1]],
]);

const drift = [...versions].filter(([, version]) => version !== expected);
if (drift.length > 0) {
  throw new Error(
    `Release version drift (expected ${expected}): ${drift
      .map(([location, version]) => `${location}=${String(version)}`)
      .join(", ")}`,
  );
}

console.log(`Release versions synchronized at ${expected}.`);
