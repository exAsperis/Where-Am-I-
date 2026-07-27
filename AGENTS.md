# Agent instructions

- Read [`docs/development-environment.md`](docs/development-environment.md) before changing dependencies, running project commands, releasing, or testing in Owlbear Rodeo.
- This is a Windows/PowerShell workspace that may be under OneDrive. Resolve and verify exact absolute targets before recursive deletes or moves. Never operate recursively on a computed, unresolved, repository-root, home, or broad path.
- Do not assume Node.js or package managers are on `PATH`. In Codex Desktop, call `codex_app.load_workspace_dependencies`, prepend its Node `bin` directory to `PATH` for each command, and invoke its returned `pnpm.cmd` explicitly.
- Use pnpm and commit `pnpm-lock.yaml`. Install with `pnpm install --frozen-lockfile` except when intentionally updating dependencies.
- If dependency type files unexpectedly disappear, rule out a OneDrive-corrupted `node_modules` before changing TypeScript or dependencies. Follow the documented recovery procedure.
- Never start a local server or use Codex browser preview for Owlbear integration. Run internal checks, build, and use an explicitly authorized hosted deployment for integration and visual testing.
- Release order is format, lint, type-check, unit tests, production build, source/generated diff review, commit/push, deployment confirmation, cache-busted public-manifest verification, then hosted Owlbear testing.
- Keep every release version/cache-buster synchronized. `pnpm run check:versions` is mandatory.
- `dist/` is generated and intentionally **not tracked**. Review a fresh production build locally before release.
- Do not push, deploy, rerun a remote workflow, or claim live/multi-client testing without explicit authorization and actual verification.
- Record intentional product or architecture decisions in `docs/decisions/`; do not turn incidental implementation details into decisions or create a competing decision log.
