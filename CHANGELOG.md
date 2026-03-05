# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.5] - 2026-03-05

### Changed
- 0.4.5
- Merge pull request #16 from eduardosanzb/feat/smart-ram-usage
- Apply suggestions from code review
- fix unique id in subjects bug
- feat: add RAM-aware config with dev/prod mode separation
- Merge pull request #15 from eduardosanzb/copilot/fix-4089986-1130323872-7bced2c8-6626-43f3-91c2-40d76cd6adef
- fix: apply Biome formatting to long import in index.test.ts
- docs: update CHANGELOG for v0.4.4
- docs: update CHANGELOG for v0.4.4
- fix: update findLatestVideo in test to use access() check matching real implementation
- Initial plan

## [0.4.4] - 2026-03-05

### Added
- Add narrative hallucination learning and artifact format architecture documentation

### Fixed
- Unify narrative generation with generate-summary-v3.ts to prevent hallucinations
- Update CHANGELOG for v0.4.3

## [0.4.4] - 2026-03-05

### Added
- Added sections on narrative hallucination learning and artifact format architecture in the documentation.

### Fixed  
- Unified narrative generation with generate-summary-v3.ts to prevent hallucinations.

## [0.4.4] - 2026-03-05

### Added
- Added narrative hallucination learning and artifact format architecture sections to the documentation.

### Fixed
- Unified narrative generation with generate-summary-v3.ts to prevent hallucinations.
- Updated CHANGELOG for v0.4.3.

## [0.4.3] - 2026-03-05

### Fixed  
- fix ignore  
- reduce package size from 30MB to 166KB by excluding unnecessary files  

### Changed  
- update documentation for v0.4.2

## [0.4.3] - 2026-03-05

### Fixed  
- Fix ignore issues  
- Reduce package size from 30MB to 166KB by excluding unnecessary files

## [0.4.2] - 2026-03-05

### Fixed  
- Handle existing local tags in release script

### Changed  
- Sync documentation with latest features

## [0.4.2] - 2026-03-05

### Fixed  
- Handle existing local tags in release script

### Changed  
- Sync documentation with latest features  
- Update CHANGELOG for v0.4.1

## [0.4.1] - 2026-03-05

### Fixed  
- Bump to 0.4.1 due to npm republish restriction

## [0.4.1] - 2026-03-05

### Fixed  
- bump to 0.4.1 due to npm republish restriction

## [0.4.0] - 2026-03-05

### Added
- Config file support with `~/.escribano/.env`
- `--latest` flag to process the most recent video in a directory

### Fixed
- Load config file at startup and improve error handling
- Check R_OK access before stat to skip permission-denied files in `findLatestVideo`
- Handle broken symlinks and inaccessible files in `--latest`
- Fixed `--None` flag per PR review

## [0.4.0] - 2026-03-05

### Added  
- Add config file support with `~/.escribano/.env`  
- Add `--latest` flag to process most recent video in directory  

### Fixed  
- Load config file at startup and improve error handling  
- Check `R_OK` access before `stat` to skip permission-denied files in `findLatestVideo`  
- Handle broken symlinks and inaccessible files in `--latest`  
- Fix `--latest` flag behavior per PR review  

### Changed  
- Refactor error handling for config loading and file access checks  

### Removed  
- (none)

## [0.4.0] - 2026-03-05

### Added
- Config file support with `~/.escribano/.env`
- `--latest` flag to process most recent video in directory

### Fixed
- Check `R_OK` access before `stat` to skip permission-denied files in `findLatestVideo`
- Handle broken symlinks and inaccessible files in `--latest`
- Fixed `--latest` flag implementation per PR review

### Changed
- Improved error handling when loading config file at startup

## [0.4.0] - 2026-03-05

### Added
- Config file support with `~/.escribano/.env`
- `--latest` flag to process most recent video in directory

### Fixed
- Load config file at startup and improve error handling
- Check `R_OK` access before `stat` to skip permission-denied files in `findLatestVideo`
- Handle broken symlinks and inaccessible files in `--latest`
- Shared python-utils, doctor managed-venv awareness, torch/torchvision in auto-install
- Increase MLX bridge startup timeout from 60s to 120s

## [0.3.0] - 2026-03-05

### Added  
- Auto-create git tags and push CHANGELOG on release  
- Automated release workflow with LLM-generated notes  

### Fixed  
- Increased MLX bridge startup timeout to 120s  
- Fixed shared python-utils, doctor managed-venv awareness, torch/torchvision in auto-install  
- Biome fix  
- Accessibility issues in mlx-vlm  

### Changed  
- Updated scripts/mlx_bridge.py  
- Applied code review suggestions (refactor)

## [0.3.0] - 2026-03-05

### Added  
- Auto-create git tags and push CHANGELOG on release  
- Automated release workflow with LLM-generated notes  

### Fixed  
- MLX VLM accessibility issues  
- Biome-related issues  
- Shared Python-utils, managed-venv awareness, and torch/torchvision auto-install fixes  
- Increased MLX bridge startup timeout to 120s  

### Changed  
- Updated MLX bridge script  
- Applied code review suggestions (refactoring/improvements)

## [0.2.2] - 2026-03-04

### Added
- Automated GitHub release workflow with LLM-generated notes
- Auto-create git tags from package.json if missing
- Auto-commit and push CHANGELOG.md changes

## [0.2.0] - 2026-03-04

### Added
- 3-state theme toggle for landing page (light/dark/system)
- Environment variable logging for debugging

### Fixed
- Include scripts/ directory in npm package for MLX bridge

### Changed
- Documentation improvements (CHANGELOG, Features section)

## [0.1.3] - 2026-03-01

### Fixed  
- Resolve MLX bridge relative to module, not current working directory (cwd)

## [0.1.1] - 2026-03-01

### Added
- feat(doctor): Smart pip detection for mlx-vlm install  
- feat(landing): Update for open-source launch with two-tier messaging  
- feat(landing): Add dark mode support  
- feat: Add 'escribano doctor' command and prerequisite checks  
- feat: Integrate Outline publishing into CLI workflow  
- feat: Outline publishing for session summaries with global index  
- feat: Smart subject reuse across artifact formats + artifact_subjects link  
- feat: Include artifact format in Outline document title  
- feat: Pass TopicBlock VLM descriptions to card LLM prompt  
- feat: Add MLX-VLM adapter for 3.5x faster frame processing  
- feat: Milestone 3 - Artifact Generation, Visual Pipeline, Outline Sync  
- feat: Complete Milestone 1 - Core Pipeline  

### Fixed
- fix: Doctor uses same Python detection as MLX adapter  
- fix: Index now correctly includes multi-format recordings  
- fix: Implement missing linkSubjects and findSubjectsByArtifact in ArtifactRepository  
- Fix UND_ERR_HEADERS_TIMEOUT by using undici with custom agent  
- fix: Sync config docs - rename OLLAMA_MODEL, add missing env vars, clean AGENTS.md  
- Fix: Restore throw in callOllama and log full prompt when debugging  
- fix: Always re-run subject grouping on artifact regeneration  
- fix: Use qwen3:32b for subject grouping (faster than qwen3.5:27b)  
- fix: Limit subject grouping to 2000 tokens  
- fix: Handle thinking models in subject grouping  
- fix: Update test to match apps/topics extraction implementation  
- fix: Add missing return, delete TopicBlocks on force, calculate Cap duration  

### Changed
- perf: Make 4bit VLM model default for 4x total pipeline speedup  
- docs: Reorganize backlog with balanced scorecard priorities and MLX-VLM as P0  
- docs: Expand CLI reference with flags, formats, and examples  
- docs: Add Coolify + Cloudflare DNS-01 deployment guide  
- docs: Add Coolify + Cloudflare DNS-01 SSL learning  
- docs: Add dashboard section and CLI commands to AGENTS.md  
- docs: Update env vars and V3 pipeline flow  
- docs: Fix VLM_BATCH_SIZE and VLM_MAX_TOKENS defaults  
- perf(scene-detection): Add -skip_frame nokey to only decode I-frames  
- refactor(vlm): Switch to sequential single-image processing  
- refactor: Address PR review comments for Milestone 3  
- chore: Cleanup for public release  
- chore: Remove competitive positioning from public repo  
- chore: Update .gitignore to exclude Python cache and POC docs

