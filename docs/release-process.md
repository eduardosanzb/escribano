# Release Process

This document describes how to create releases for Escribano.

## Overview

Releases are **fully automated** via npm's `postpublish` hook. When you run `npm publish`, the following happens automatically:

1. ✅ npm publishes the package
2. 🤖 LLM (Ollama) analyzes commits since last tag
3. 📝 Generates human-readable release notes
4. 📄 Updates `CHANGELOG.md`
5. 🚀 Creates GitHub release

## Prerequisites

- Ollama running locally (default: `http://localhost:11434`)
- Model installed: `qwen3:8b` (or set `ESCRIBANO_LLM_MODEL`)
- `gh` CLI authenticated with GitHub

## Creating a Release

### Standard Release

```bash
# 1. Bump version in package.json
npm version patch  # or minor, or major

# 2. Update CHANGELOG manually if needed (optional)

# 3. Commit and tag
git add .
git commit -m "chore: bump version to x.y.z"
git push
git push --tags

# 4. Publish (this triggers everything automatically)
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

### "No git tag found at current commit"

**Problem**: The postpublish hook can't find a tag.

**Solution**: Make sure you create and push the tag *before* running `npm publish`:

```bash
npm version patch
git push --tags
npm publish
```

### Ollama Connection Failed

**Problem**: Can't connect to Ollama.

**Solution**: Ensure Ollama is running:

```bash
ollama serve
```

Or use fallback (simple format without LLM):

```bash
# The script will automatically fall back to simple format
npm publish
```

### Release Already Exists

**Problem**: GitHub release already exists for this tag.

**Solution**: The script will skip creation and show a warning. To recreate:

```bash
# Delete the release
gh release delete v1.2.3 --yes

# Run the script again
node scripts/create-release.mjs
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
