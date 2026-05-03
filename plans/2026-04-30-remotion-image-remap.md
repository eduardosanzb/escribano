# Quick Fix: Remap Images + Build React Components

**Date**: 2026-04-30 **Status**: IN PROGRESS

## New Scene Mapping

| Scene | Image | Text | Built With |
|-------|-------|------|------------|
| **Intro** | None | Brand + tagline | Existing React |
| **Capture** | `menu-app.png` | "Capture, quietly" | Image + text |
| **Understand** | None (React) | "Understand, on-device" | React moment cards |
| **Query** | `claude-escribano.png` | "Query from any agent" | Image + text |
| **Answer** | `agent-answer.png` | "Ready to cite" | Image + text |
| **Outro** | None | CTA | Existing React |

## Work Units

### WU-1: Update CaptureScene with menu-app.png
- Swap `health.png` → `menu-app.png`
- Text: "Capture, quietly" / "Records your screen in the background. Nothing leaves your machine."

### WU-2: Rebuild ConnectScene as UnderstandScene with React moment cards
- Remove `agents.png`
- Build 3 animated moment cards:
  - Card 1: 14:32 VS Code — "Debugging JWT refresh flow in middleware/auth.ts"
  - Card 2: 14:47 Terminal — "Committed fix for refresh-token expiry"
  - Card 3: 16:40 GitHub — "Reviewing PR #214 with auth changes"
- Cards slide in from right with stagger
- Each card has: timestamp, app icon, description

### WU-3: Update AskScene with claude-escribano.png
- Swap `query-json.png` → `claude-escribano.png`
- Text: "Query from any agent" / "Claude Code, Cursor, Codex — ask what you worked on in plain language."

### WU-4: Keep AnswerScene
- Already uses `agent-answer.png`
- Text stays "Ready to cite"

## Execution

Phase 1 (parallel): WU-1, WU-2, WU-3
Phase 2: Verify TypeScript + test preview
