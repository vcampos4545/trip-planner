# Contributing

## Branches

- `main` always builds and passes every check. Nobody commits to it directly.
- Work happens on short-lived branches named by type: `feat/<topic>`, `fix/<topic>`,
  `chore/<topic>`, `docs/<topic>`, `test/<topic>`. Automated agents use `fm/<topic>`.
- Rebase on `main` before merging so history stays linear, then merge with a fast-forward or a
  squash.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add booking participants
fix(ui): keep the menu from staying open after saving
docs: explain Google OAuth setup
```

Common types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`. Keep each commit to one logical
change that builds on its own. Never commit secrets or `.env` files; only `.env.example` is tracked.

## Versions and releases

The project follows [Semantic Versioning](https://semver.org/):

- MAJOR for breaking changes to data, configuration, or behavior people depend on.
- MINOR for new features.
- PATCH for fixes.

To release:

1. Move the `Unreleased` entries in `CHANGELOG.md` under a new version heading with the date.
2. Set the same version in `package.json`.
3. Commit on a branch as `chore(release): vX.Y.Z` and merge it to `main`.
4. Tag the merge commit on `main` with an annotated tag: `git tag -a vX.Y.Z -m "vX.Y.Z"`, then
   push the tag.

Tags are created only on `main`, after the release commit lands.

## Before you open a pull request

Start the database with `pnpm db:up`, then run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

## Database changes

- Change `prisma/schema.prisma`, then create a migration with
  `pnpm db:migrate --name <short_description>`.
- Never edit a migration that has been merged. Add a new one instead.
- Keep authorization in the service layer: every trip-scoped query includes the caller's trip ID.

## Code conventions

- Server-only modules import `server-only`. Secrets are read only on the server.
- Validate every input with Zod, in the server action, even if the form already validated it.
- Put pure rules in `src/lib/domain` with unit tests. Keep services thin and authorized.
- The product name comes from `src/config/brand.ts`. Do not hardcode it elsewhere. The assistant
  is always called Atlas (`ASSISTANT_NAME`).
