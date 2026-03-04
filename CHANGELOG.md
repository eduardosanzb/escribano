# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

