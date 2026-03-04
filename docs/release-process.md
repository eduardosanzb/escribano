# Release Process

This document describes how to create releases for Escribano.

## Overview

Releases are **fully automated** via npm's `postpublish` hook. When you run `npm publish`, the following happens automatically:

1. ✅ npm publishes the package
2. 🏷️ Auto-creates git tag if missing (reads version from package.json)
3. 📝 Generates release notes (LLM or GitHub auto-generation)
4. 📄 Updates `CHANGELOG.md`
5. 🚀 Creates GitHub release
6. ⬆️ Commits and pushes CHANGELOG changes

## Prerequisites

- `gh` CLI authenticated with GitHub
- Ollama running locally (optional, for LLM-generated notes)
- Model installed: `qwen3:8b` (or set `ESCRIBANO_LLM_MODEL`)

## Creating a Release

### Simple Release

```bash
npm publish
```

That's it! Everything else is automated:

- ✅ Tag created automatically if missing
- ✅ GitHub release created
- ✅ CHANGELOG.md updated and pushed
- ✅ All changes committed to repo

### With Version Bump

If you want to bump the version first:

```bash
# Bump version
npm version patch  # or minor, or major

# Publish (tag already exists, will be used)
npm publish
```

### What Happens Automatically

After `npm publish` completes, the `postpublish` hook runs `scripts/create-release.mjs`:

1. **Detects current tag** using `git describe --tags --exact-match`
2. **Gets commits** since previous tag
3. **Generates release notes** using Ollama LLM
4. **Updates CHANGELOG.md** with new entry
5. **Creates GitHub release** via `gh` CLI

### Manual Override

If the automatic process fails, you can manually create a release:

```bash
# Option 1: Run the script manually
node scripts/create-release.mjs

# Option 2: Use gh CLI directly
gh release create v1.2.3 --title "v1.2.3" --generate-notes
```

## Backfilling Historical Releases

To create releases for existing tags (already pushed to GitHub):

```bash
node scripts/backfill-releases.mjs v0.1.0 v0.2.0 v0.3.0
```

This is useful for:
- Creating releases for tags that existed before this automation
- Recreating releases if something went wrong

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ESCRIBANO_LLM_MODEL` | `qwen3:8b` | Ollama model for generating release notes |

### Example with Custom Model

```bash
ESCRIBANO_LLM_MODEL=qwen3.5:27b npm publish
```

## Release Notes Format

The LLM generates notes in [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
## [1.2.3] - 2026-03-04

### Added
- New feature description

### Fixed
- Bug fix description

### Changed
- Improvement description

### Removed
- Deprecated feature removal
```

## Troubleshooting

### Ollama Connection Failed

**Problem**: Can't connect to Ollama.

**Solution**: The script will automatically fall back to GitHub's auto-generated notes. No action needed.

### Tag Already Exists at Different Commit

**Problem**: Version in package.json matches an existing tag at a different commit.

**Solution**: Bump the version:

```bash
npm version patch
npm publish
```

## Files

| File | Purpose |
|------|---------|
| `scripts/create-release.mjs` | Postpublish hook (automatic) |
| `scripts/backfill-releases.mjs` | Backfill historical releases |
| `CHANGELOG.md` | Auto-updated changelog |
| `package.json` | Contains `postpublish` hook |

## Best Practices

1. **Always push tags before publishing** - The hook needs the tag to exist
2. **Review CHANGELOG.md** - After publishing, review and commit if needed
3. **Use semantic versioning** - `npm version patch|minor|major`
4. **Test locally first** - Run `node scripts/create-release.mjs` to test

## Future Improvements

- [ ] Auto-commit CHANGELOG.md changes
- [ ] Support conventional commits parsing
- [ ] Add GitHub Actions fallback (if local Ollama fails)
- [ ] Generate release assets (binaries, etc.)
