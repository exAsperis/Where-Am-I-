# Development environment

## Scope

This repository is developed in Codex Desktop on Windows with PowerShell and may live beneath OneDrive. This document is the source of truth for environment recovery, internal verification, releases, and Owlbear Rodeo manual testing. Product and architecture decisions belong in `docs/decisions/`.

## Toolchain

Do not try ordinary `node`, `npm`, `npx`, `pnpm`, or `corepack` first. They may not be on `PATH`, and ordinary `pnpm` is a known dead end in Codex Desktop.

Before any install, format, lint, type-check, test, or build:

1. Call `codex_app.load_workspace_dependencies`.
2. Copy the returned Node.js executable directory and bundled `pnpm.cmd` path.
3. For each PowerShell command, prepend that Node directory to that command's `PATH` and invoke the returned pnpm executable explicitly.

Copyable pattern (replace both placeholders with values returned for the current session):

```powershell
$env:PATH = '<RETURNED_NODE_BIN_DIRECTORY>;' + $env:PATH
& '<RETURNED_PNPM_CMD>' install --frozen-lockfile
& '<RETURNED_PNPM_CMD>' run check
& '<RETURNED_PNPM_CMD>' run build
```

Do not save machine-specific returned paths in repository files. The project declares pnpm in `package.json`, commits `pnpm-lock.yaml`, and uses `pnpm-workspace.yaml` to make the package-manager boundary explicit.

## Safe filesystem work and OneDrive recovery

Use Windows-safe commands and literal absolute paths for risky operations. Before any recursive delete or move, resolve the target and confirm it is an exact child of this repository. Never delete an unresolved variable, computed broad path, repository root, home directory, or filesystem root.

OneDrive can leave `node_modules` present but partially missing. Typical misleading TypeScript errors include missing `chai`, `deep-eql`, or `estree` type definitions.

Recovery:

1. Get the repository root and exact dependency path:

   ```powershell
   $repo = (Resolve-Path -LiteralPath '.').Path
   $modules = Join-Path $repo 'node_modules'
   $resolvedParent = (Resolve-Path -LiteralPath (Split-Path -Parent $modules)).Path
   if ($resolvedParent -ne $repo -or $modules -eq $repo) { throw 'Unsafe node_modules target' }
   $modules
   ```

2. Visually confirm the printed target is exactly `<current repository>\node_modules`.
3. Only then remove that generated directory:

   ```powershell
   if (Test-Path -LiteralPath $modules) { Remove-Item -LiteralPath $modules -Recurse -Force }
   ```

4. Call `codex_app.load_workspace_dependencies` again if needed, prepend the returned Node `bin` path, and run the returned `pnpm.cmd`:

   ```powershell
   & '<RETURNED_PNPM_CMD>' install --frozen-lockfile
   & '<RETURNED_PNPM_CMD>' run typecheck
   & '<RETURNED_PNPM_CMD>' run test
   & '<RETURNED_PNPM_CMD>' run build
   ```

Do not weaken TypeScript settings or add unrelated dependencies until corruption is ruled out.

## Commands

All commands below mean the bundled pnpm invocation described above.

| Command                   | Purpose                         |
| ------------------------- | ------------------------------- |
| `pnpm run format`         | Apply Prettier                  |
| `pnpm run format:check`   | Verify formatting               |
| `pnpm run lint`           | Run ESLint                      |
| `pnpm run typecheck`      | Run TypeScript without emitting |
| `pnpm run test`           | Run unit/release checks once    |
| `pnpm run check:versions` | Detect release-version drift    |
| `pnpm run check`          | Run all safe internal checks    |
| `pnpm run build`          | Create the production `dist/`   |

`dist/` is ignored rather than tracked. Review its contents and the source diff before release, but do not commit it.

## Build and hosting

Vite produces separate `main.html` and `background.html` entry pages plus the public `manifest.json`. The default local base is `/`; production must set `VITE_BASE_PATH` to the actual hosting subpath, including leading and trailing slashes. The GitHub Pages workflow derives `/<repository-name>/`, so a renamed repository automatically gets the matching base.

The production workflow in `.github/workflows/deploy-pages.yml` runs frozen installation, all internal checks, a production build, and then deploys the artifact to GitHub Pages. It requires Pages to use **GitHub Actions** as its source. A remote push, deployment, or workflow rerun is an external mutation and requires explicit user authorization.

## Release and cache invalidation

For every public behavior change, update all of these together:

- `package.json` version;
- `public/manifest.json` version;
- query version on the manifest popover URL;
- query version on the manifest background URL;
- query version on both manifest icon URLs;
- `src/version.ts` deterministic asset/cache-buster.

`pnpm run check:versions` fails on drift. Add any future public URLs, including context-menu pages, to both the synchronization check and this list.

The production repository is `exAsperis/Where-Am-I-`, so the GitHub Pages base and public extension root are `https://exasperis.github.io/Where-Am-I-/`. If the repository owner or name changes, update `package.json`, every hosted URL in `public/manifest.json`, and this documentation; the workflow build base will continue to derive from the repository name.

Release order:

1. Format.
2. Lint.
3. Type-check.
4. Run unit tests.
5. Produce a production build with the real hosting base.
6. Review source and generated-output diffs.
7. Commit and push only the reviewed result.
8. Let the configured host deploy it and confirm completion.
9. If GitHub Pages reports a transient `startup_failure` before a job starts, inspect the run before blaming source. Do not rerun without authorization.
10. Fetch the public manifest with a unique cache-busting query, for example `manifest.json?verify=<timestamp>`.
11. Fetch and verify every URL referenced by that manifest.
12. Only then test integration and visuals in Owlbear Rodeo.

Never trust deployment status alone; verify public bytes and referenced assets.

## Manual Owlbear testing

Local Owlbear integration is not usable here: Codex's isolated browser cannot reach the Windows local server. Do not start a local server and do not open the extension through browser preview. Static checks and unit tests remain mandatory; integration and visual tests use the hosted build.

Reloading Owlbear may reset the viewport. Before reload, record Position X, Position Y, and Zoom. Restore in this exact order:

1. Zoom
2. Position Y
3. Position X

Zoom last changes effective position, and setting Y can alter X. Close Players and Scene panels before visual comparisons.

A screenshot cannot prove timing or synchronization. Observe behavior over time or record video. Multi-client behavior must be tested with the required signed-in clients; report unavailable cases as unverified. Multiple GM clients each run a background extension instance and can expose real coordination bugs, not harmless noise.
