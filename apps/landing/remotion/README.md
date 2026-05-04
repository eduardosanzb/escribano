# Escribano Remotion Video System

This directory contains the Remotion-based video generation system for Escribano's marketing content. It produces videos in multiple aspect ratios from shared source components.

## Quick Start

```bash
cd apps/landing

# Preview in browser
pnpm video:preview

# Render a specific format
pnpm video:render:desktop    # 1920×1080 landscape
pnpm video:render:mobile     # 1080×1920 vertical (Stories/Reels)
pnpm video:render:linkedin   # 1080×1350 vertical (LinkedIn feed)

# Render all formats
pnpm video:render:all
```

Rendered videos are output to `apps/landing/static/video/`.

## Available Compositions

| Composition | Dimensions | Aspect | Use Case | Component |
|-------------|-----------|--------|----------|-----------|
| **EscribanoDemo** | 1920×1080 | 16:9 | Website hero section | `EscribanoDemo` |
| **EscribanoAgentMemory** | 1920×1080 | 16:9 | Desktop agent demo | `EscribanoAgentMemory` |
| **EscribanoAgentMemoryMobile** | 1080×1920 | 9:16 | Mobile/Reels | `EscribanoAgentMemoryMobile` |
| **EscribanoAgentMemoryLinkedIn** | 1080×1350 | 4:5 | LinkedIn feed | `EscribanoAgentMemoryMobile` |

The LinkedIn and Mobile compositions share the same `AgentPanelMobile` component — layout adapts automatically to canvas dimensions.

## Architecture

### Responsive Panel System

The `AgentPanelMobile` component uses `useVideoConfig()` to derive all layout values from the actual canvas size, rather than hardcoding for a specific resolution.

**Key principle**: Content components (`ChatMessage`, `ThinkingBlock`, `AnswerBlock`, etc.) are layout-agnostic. Only the panel wrapper handles positioning.

**Proportional scaling** (from `AgentPanelMobile.tsx`):
```tsx
const {width, height} = useVideoConfig();

// Content scales proportionally with canvas
width: Math.round(width * 0.87),        // ~94% of canvas width
marginLeft: Math.round(width * 0.065),  // centered
paddingTop: Math.round(height * 0.063), // ~6% of canvas height
scrollOffset: scrollProgress * Math.round(height * 0.625),
```

**Timing is fixed**: Frame-based animation timing (`promptStart`, `thinkingStart`, `answerStart`, etc.) is independent of canvas size. Only spatial layout adapts.

### Adding a New Format

To add a new portrait format (e.g., 4:5 for Instagram):

1. **Register the composition** in `root.tsx`:
   ```tsx
   <Composition
     id="EscribanoAgentMemoryInstagram"
     component={EscribanoAgentMemoryMobile}
     durationInFrames={AGENT_MEMORY_DURATION_MOBILE}
     fps={60}
     width={1080}
     height={1350}  // or your target height
   />
   ```

2. **Add a render script** in `package.json`:
   ```json
   "video:render:instagram": "pnpm video:render EscribanoAgentMemoryInstagram static/video/escribano-agent-memory-instagram.mp4 --codec=h264 --crf=18"
   ```

3. **Update the all-formats script**:
   ```json
   "video:render:all": "pnpm video:render:desktop & pnpm video:render:mobile & pnpm video:render:linkedin & pnpm video:render:instagram"
   ```

No component changes are needed — the responsive panel handles it automatically.

## File Structure

```
remotion/
├── src/
│   ├── index.ts              # Remotion entry point (registerRoot)
│   ├── root.tsx              # Composition definitions
│   ├── video.tsx             # Desktop 6-scene demo (EscribanoDemo)
│   ├── agent-video.tsx       # Desktop agent memory demo
│   ├── agent-video-mobile.tsx # Mobile agent memory demo (uses responsive panel)
│   ├── agent-video/          # Agent demo components
│   │   ├── AgentStage.tsx    # Background, fonts, colors, grain overlay
│   │   ├── AgentPanel.tsx    # Desktop 16:9 layout (800px centered)
│   │   ├── AgentPanelMobile.tsx  # Responsive portrait layout (scales with canvas)
│   │   ├── ChatMessage.tsx   # Typing animation for chat messages
│   │   ├── ThinkingBlock.tsx # CLI thinking visualization
│   │   ├── AnswerBlock.tsx   # Structured answer with animated words
│   │   ├── MiniCliCall.tsx   # Small CLI call block
│   │   ├── DocumentDraft.tsx # Markdown document drafting animation
│   │   ├── LogoLockup.tsx    # Brand logo + tagline end card
│   │   ├── AgentStage.tsx    # Background stage component
│   │   └── AgentPanelMobile.tsx  # Mobile portrait panel (responsive)
│   ├── scenes/               # 6-scene desktop demo scenes
│   │   ├── IntroScene.tsx
│   │   ├── CaptureScene.tsx
│   │   ├── ConnectScene.tsx
│   │   ├── AskScene.tsx
│   │   ├── AnswerScene.tsx
│   │   └── OutroScene.tsx
│   ├── components/           # Shared components
│   │   ├── Stage.tsx         # Desktop stage (background + grain)
│   │   └── AmbientMusic.tsx  # Audio track setup
│   └── motion.ts             # Animation utilities (float, parallax)
├── public/
│   └── assets/               # Static images referenced by scenes
│       ├── menu-app.png
│       ├── claude-escribano.png
│       ├── agent-answer.png
│       └── ...
└── tsconfig.json             # TypeScript config (ES2022, Bundler resolution)
```

## Asset Management

**Critical**: Remotion's `staticFile()` resolves from the **current working directory** (CWD), not from the `remotion/` subdirectory.

When `pnpm video:preview` runs from `apps/landing/`, `staticFile('assets/foo.png')` looks in:
```
apps/landing/public/assets/foo.png
```

**NOT** in:
```
apps/landing/remotion/public/assets/foo.png
```

**Rule**: Every image added to `remotion/public/assets/` must also be copied to `apps/landing/public/assets/`. For Hugo builds, also ensure it's in `apps/landing/static/assets/` if used on the website itself.

## Content Iteration

To iterate on video content:

1. Edit the narrative in `AgentPanelMobile.tsx` (prompt text, thinking narrative, answer lines, document content)
2. Preview with `pnpm video:preview` and select the target composition
3. Render with the appropriate `pnpm video:render:*` command

All formats share the same content — edit once, render everywhere.

## Technical Specs

- **Framework**: Remotion 4.0.454
- **React**: 19.2.5
- **TypeScript**: 5.9.3
- **Module Resolution**: Bundler
- **Codec**: H.264 (CRF 18)
- **Audio Sample Rate**: 48000 Hz
- **Frame Rate**: 60fps (agent demos), 30fps (6-scene demo)

## Troubleshooting

**Preview shows 404 for images**: Check that the image exists in `apps/landing/public/assets/` (not just `remotion/public/assets/`).

**Layout looks wrong on new format**: Verify the `AgentPanelMobile` proportional scaling produces reasonable values for your target dimensions. The current ratios are tuned for 1080px width; very narrow or very wide canvases may need ratio adjustments.

**TypeScript errors after editing**: Run `cd apps/landing/remotion && npx tsc --noEmit` to check for type errors before rendering.
