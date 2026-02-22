# Competitive Analysis: Screenpipe & AI Memory Landscape

> **Date**: 2026-02-22  
> **Purpose**: Strategic synthesis for Escribano positioning, roadmap, and launch strategy  
> **Sources**: Screenpipe compare pages (13 competitors), GitHub repo analysis, landscape research, ADR-005 postmortem

---

## Executive Summary

### Core Insight: The Intelligence Gap

The entire screen/audio AI market competes on **data privacy and capture breadth**, not on **intelligence quality**. Screenpipe, the category leader, positions itself as a "platform that records everything and makes it searchable." But they explicitly do not claim to understand what you're doing.

This is the strategic gap Escribano occupies.

### Escribano's Unique Position

**Screenpipe = "I'll record everything and make it searchable."**

**Escribano = "I'll watch you work, understand what you're doing, and write about it."**

| Dimension | Screenpipe | Escribano |
|-----------|-----------|-----------|
| **Philosophy** | Data platform | Domain application |
| **Core value** | Raw data availability | Intelligence quality per session |
| **Primary signal** | OCR text tokens | VLM semantic descriptions |
| **Segmentation** | None — flat timeline | Activity continuity → TopicBlocks |
| **Output** | Search results | Narrative artifacts |
| **Cross-recording** | Impossible | Context entity spans recordings |

### Key Differentiator

Escribano is the only tool that **segments developer work by activity type** (debugging, coding, research, reading, terminal, meeting) and produces **structured, narrative summaries** from those segments. The rest of the market either captures raw data without understanding (Screenpipe) or only works during meetings (Granola, Otter, tl;dv).

---

## 1. Market Landscape Overview

### 1.1 Market Segment Taxonomy

```
┌─────────────────────────────────────────────────────────────────┐
│                    SCREEN/AUDIO AI TOOLS                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MEMORY / RECORDING PLATFORMS                                    │
│  ├─ Screenpipe     — open source, local, 24/7, API platform     │
│  ├─ Rewind/Limitless — closed, cloud, pendant hardware           │
│  ├─ Microsoft Recall — Windows only, built into OS               │
│  ├─ ScreenMemory   — closed source, Mac only, basic OCR search  │
│  └─ Omi            — wearable pendant + desktop, cloud           │
│                                                                  │
│  MEETING ASSISTANTS (audio-first)                                │
│  ├─ Granola        — bot-free, system audio, polished notes      │
│  ├─ Otter.ai       — bot-based, strong transcription, free tier  │
│  ├─ Fireflies.ai   — CRM integrations, sales-focused            │
│  ├─ tl;dv          — video recording + sales analytics           │
│  ├─ Fathom         — free, fast summaries, Zoom/Meet/Teams       │
│  └─ Jamie          — offline, bot-free, speaker memory           │
│                                                                  │
│  DEVELOPER CONTEXT TOOLS                                         │
│  ├─ Pieces         — code snippet management, not session-based  │
│  └─ (nothing else fills this space)                              │
│                                                                  │
│  ═══════════════════════════════════════════════════════════════  │
│  GAP: SESSION INTELLIGENCE FOR DEEP WORK                         │
│  ├─ Nobody understands silent coding sessions                    │
│  ├─ Nobody segments developer work by activity                   │
│  ├─ Nobody produces structured narratives from work sessions     │
│  └─ THIS IS WHERE ESCRIBANO LIVES                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Competitive Positioning Map

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              COMPETITIVE POSITIONING MAP                                │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│   HIGH INTELLIGENCE                                                                    │
│        │                                                                                │
│        │                           ┌──────────────┐                                     │
│        │                           │  ESCRIBANO   │ ◄── VLM-first, segmented,           │
│        │                           │              │     narrative artifacts             │
│        │                           └──────────────┘                                     │
│        │                                                                                │
│        │    ┌──────────┐                                                               │
│        │    │ Granola  │ ◄── Best meeting understanding                               │
│        │    └──────────┘     but meeting-only                                        │
│        │                                                                                │
│        │                                          ┌─────────────┐                      │
│        │                                          │   Pieces    │ ◄── IDE context      │
│        │                                          └─────────────┘     only             │
│        │                                                                                │
│   LOW ──┼──────────────────────────────────────────────────────────────────────────────│
│        │                                                                                │
│        │    ┌────────────┐  ┌───────────┐  ┌─────────────┐  ┌────────────┐             │
│        │    │ Screenpipe │  │  Limitless│  │  Otter.ai   │  │  tl;dv     │             │
│        │    └────────────┘  └───────────┘  └─────────────┘  └────────────┘             │
│        │         │               │               │                │                    │
│        │         └───────────────┴───────────────┴────────────────┘                    │
│        │                         Raw data + search                                     │
│        │                         (no understanding)                                    │
│        │                                                                                │
│        └───────────────────────────────────────────────────────────────────────────────│
│                           LOW ◄─────── CAPTURE BREADTH ───────► HIGH                   │
│                                                                                         │
│        Screenpipe has maximum breadth (24/7, all platforms)                           │
│        Escribano has maximum depth (understanding per session)                        │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 The Universal Blind Spot

**What every competitor assumes:**
- Work = meetings (Otter, Granola, tl;dv)
- Work = web browsing (Remio)
- Work = what you explicitly save (Pieces)
- Work = everything, unfiltered (Screenpipe)

**What nobody assumes:**
- Work = structured activity that needs understanding
- Sessions have activity types that change over time
- Silent coding/debugging sessions need documentation too
- Understanding > capture quantity

---

## 2. Screenpipe Deep Dive

### 2.1 Company Overview

- **Founded**: 2024, San Francisco
- **License**: MIT (open source)
- **GitHub**: ~17k stars, 92 contributors
- **Tech Stack**: 58% Rust / 39% TypeScript
- **Core Thesis**: Record everything → store locally → expose via API → let consumers (pipes, MCP, external tools) add intelligence

### 2.2 Seven-Layer Architecture

```
Layer 1: CAPTURE          [Rust, platform-native]
  ├─ Screen: CoreGraphics (macOS), DXGI (Windows), X11/PipeWire (Linux)
  ├─ Audio: CoreAudio / WASAPI / PulseAudio — mic + system simultaneously
  ├─ UI Monitoring: Accessibility APIs (macOS only, experimental)
  ├─ Keyboard + Clipboard capture (newer feature)
  └─ All monitors, configurable intervals, MP4 encoding

Layer 2: PROCESSING       [Rust, platform-native]
  ├─ OCR: Apple Vision (macOS) > Windows OCR > Tesseract (Linux/fallback)
  ├─ STT: whisper.cpp (local default) or Deepgram (cloud opt-in)
  ├─ Speaker identification / diarization
  ├─ PII redaction (optional)
  └─ Embeddings (optional, for semantic search)

Layer 3: STORAGE           [SQLite + disk]
  ├─ ~/.screenpipe/db.sqlite — FTS5 full-text search
  │   ├─ frames: OCR text + app name + window title + URL + timestamp
  │   ├─ audio_transcriptions: text + speaker + timestamps
  │   └─ pipes: plugin config
  └─ ~/.screenpipe/data/ — MP4 video + audio segments

Layer 4: API               [localhost:3030, REST + SSE]
  ├─ GET /search — full-text + filters (app, window, date, content_type)
  ├─ GET /frames, /audio — media access
  ├─ GET /health — system status
  ├─ SSE /stream/vision, /stream/audio — real-time streams
  ├─ Pipe CRUD — install/configure/manage plugins
  └─ Raw SQL access to SQLite

Layer 5: PLUGINS (Pipes)   [TypeScript/Next.js in Bun sandbox]
  ├─ Markdown pipes (pipe.md): prompt + schedule → AI agent executes
  ├─ Next.js pipes: full web apps in sandboxed environment
  ├─ Access to @screenpipe/js SDK + screenpipe API
  └─ Community marketplace with Stripe monetization

Layer 6: MCP SERVER        [Node.js, screenpipe-mcp npm package]
  ├─ search-content: search screen/audio history (all platforms)
  ├─ search-ui-events: accessibility-level events (macOS only)
  ├─ export-video: clip from time range
  ├─ MCP Apps: interactive HTML UIs in AI clients
  └─ Zero config: `claude mcp add screenpipe -- npx -y screenpipe-mcp`

Layer 7: UI (Desktop App)  [Tauri = Rust backend + React/TS frontend]
  ├─ Timeline view (DVR-style, video-based seeking — 300x faster)
  ├─ Search interface (NL search across all captured data)
  ├─ Settings + pipe management
  ├─ System tray (recording status)
  └─ Apple Intelligence integration (macOS 26+, Foundation Models)
```

### 2.3 Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Core language | Rust | Near-native perf for 24/7 capture, safe FFI to OS APIs |
| Extension language | TypeScript | Developer familiarity for plugin ecosystem |
| Desktop framework | Tauri | ~10MB binary vs ~100MB Electron, native webview, Rust backend already exists |
| Database | SQLite + FTS5 | Zero-config, embedded, fast enough for single-user. No server process. |
| Media storage | MP4 segments | H.264 compression: ~20-50KB/frame vs 2-5MB PNG. Enables ~15GB/month 24/7. |
| API design | REST on localhost:3030 | Universal integration point — UI, pipes, MCP, CLI all use same API |
| AI approach | Pluggable / external | No built-in intelligence beyond OCR + STT. Pipes and MCP consumers bring AI. |

### 2.4 Resource Footprint

| Resource | Usage |
|----------|-------|
| CPU | 5-15% on modern hardware |
| RAM | 0.5-3 GB |
| Storage | ~15 GB/month (24/7, all monitors) |
| Minimum | 8 GB RAM recommended |

### 2.5 Pricing Model

| Tier | Price | Features |
|------|-------|----------|
| Core Engine | Free (MIT) | Full open-source build |
| Lifetime | $400 one-time | All features, all updates |
| Lifetime + Pro 1yr | $600 | + cloud sync, priority support |
| Pro subscription | $39/month | Cloud sync, pro AI models |

### 2.6 Screenpipe Strengths

| Strength | Detail | Relevance to Escribano |
|----------|--------|------------------------|
| **Privacy-first** | Everything local by default. Genuine differentiator vs cloud competitors. | Escribano shares this principle — not a differentiator against screenpipe. |
| **Platform-native capture** | CoreGraphics/DXGI/X11 = low overhead + window metadata access | Escribano delegates to Cap — less control, but less engineering surface. |
| **MP4 encoding** | Compressed video segments instead of individual screenshots. Storage efficient. | Escribano extracts frames from Cap's MP4 and stores images separately. Consider keeping only MP4 + index. |
| **Pipes system** | Markdown agents + Next.js apps. Turns recorder into platform. Marketplace with Stripe. | Escribano has no plugin system. Not needed for tool positioning but worth noting. |
| **MCP integration** | Zero-config MCP server. Instant usability from Claude, Cursor, VS Code. | **Steal this.** Escribano's TopicBlocks via MCP would be more useful than screenpipe's flat OCR. |
| **Concentric data model** | Raw MP4 → OCR → embeddings → AI memories. Each layer adds intelligence, raw data preserved. | Escribano's model is richer (4 aggregate roots) but similar principle. |
| **Cross-platform** | macOS + Windows + Linux from single Rust codebase | Escribano is macOS only. Port via screenpipe-as-capture-layer or ScreenCaptureKit. |
| **Ecosystem / distribution** | 17k stars, 92 contributors, marketplace, active Discord | Escribano has none of this yet. Consider screenpipe pipe for distribution. |

### 2.7 Screenpipe Weaknesses (Escribano Advantages)

| Weakness | Detail | Escribano Advantage |
|----------|--------|---------------------|
| **No understanding** | OCR extracts text but can't tell "debugging" from "reading docs". Intelligence burden on consumer. | **Core advantage.** VLM-first pipeline classifies activities semantically. |
| **No segmentation** | Flat timeline. No concept of "work segments" or "topic blocks". Can't answer "what did I work on?" natively. | TopicBlocks + activity segmentation built into data model. |
| **OCR fails for developer work** | All code screens produce similar tokens (const, function, import). Clustering by OCR similarity collapses. | **Proven by ADR-005.** V2 failure: 1776 frames → 1 cluster. VLM-first solves this. |
| **No cross-recording context** | Flat tables, no semantic labels spanning recordings. Can't query "all debugging on project X this week." | Context entity is cross-recording by design. `TopicBlockRepository.findByContext()`. |
| **Whisper hallucinations** | Direct-to-Whisper without VAD preprocessing. Likely produces garbage during silent coding sessions. | 3-layer pipeline: Silero VAD → Whisper thresholds → hallucination filter. Battle-tested. |
| **Linux second-class** | Build from source only, Tesseract-only OCR, no UI monitoring | Not relevant — Escribano is macOS only too. |
| **SQLite scalability** | No archival strategy for months/years of 24/7 recording. FTS5 indexes grow. | Escribano has same risk but lower volume (session-based, not 24/7). |
| **Privacy paradox** | Records everything including passwords, private messages. Encryption at rest not default. | Escribano records sessions explicitly, not 24/7. Smaller attack surface. |
| **No ADR discipline** | Architecture implicit in code. 92 contributors, no documented decisions. | Escribano's ADR chain (001-005) is a competitive asset — shows engineering rigor. |

---

## 3. Complete Competitor Breakdown (13 Tools)

### 3.1 Littlebird

**Tagline**: "Context-aware AI assistant for Mac"

| Feature | Screenpipe | Littlebird |
|---------|-----------|-----------|
| Open Source | Yes | No |
| Platform | Mac, Win, Linux | Mac only |
| Multi-Monitor | All monitors | Active window only |
| Data Storage | 100% local | Local + Cloud |
| Screen Capture | Continuous + OCR | No (text from active window only) |
| Audio Recording | Yes | Meetings only |
| API Access | Yes | No |
| Agentic Workflows | Yes | No |

**Screenpipe's Verdict**: "Littlebird is a nice little Mac assistant for simple use cases — task suggestions, daily journals, basic context from your active window. But it only reads text from one window at a time. No screenshots, no screen recording, no keyboard or clipboard tracking. Screenpipe captures everything: screen recordings, app content, keyboard input, clipboard, mouse activity, and audio — across all your monitors. It's like comparing a notepad to a DVR."

**Key Insight**: Littlebird is meeting-mentality applied to desktop — only sees what you're focused on right now. Misses 90% of multi-monitor setups.

**Escribano Differentiation**: Littlebird sees the active window; Escribano understands the entire session. Littlebird gives task suggestions; Escribano produces structured documentation of what you actually did.

---

### 3.2 Limitless (formerly Rewind AI)

**Tagline**: "AI wearable + cloud memory ecosystem"

| Feature | Screenpipe | Limitless |
|---------|-----------|-----------|
| Open Source | Yes | No |
| Platform | Mac, Win, Linux | Mac, Win, iOS |
| Data Storage | 100% local | Cloud-based |
| Screen Recording | Yes | Limited |
| Audio Recording | Yes | Yes |
| API Access | Yes | No |
| Custom Plugins | Yes | No |
| Local AI | Yes | Cloud only |
| Hardware Required | No | Pendant (proprietary) |

**Screenpipe's Verdict**: "Limitless pioneered the AI memory space but has pivoted to a hardware + cloud model with their Pendant wearable. While polished and well-funded, it requires cloud processing and proprietary hardware. Screenpipe keeps everything local, is fully open-source, and works with any microphone you already own."

**Key Insight**: Hardware lock-in + cloud dependency. Screenpipe's comparison page leads with "No hardware required" and "where does your data go?"

**Escribano Differentiation**: Limitless captures cloud data from hardware; Escribano understands local sessions with intelligence. Different philosophies entirely.

---

### 3.3 Microsoft Recall

**Tagline**: "Windows 11 built-in AI screenshot search"

| Feature | Screenpipe | Recall |
|---------|-----------|-----------|
| Open Source | Yes | No |
| Platform | Mac, Win, Linux | Win 11 Copilot+ only |
| Special Hardware | No | NPU required |
| Screen Recording | Continuous video | Periodic screenshots |
| Audio Recording | Yes | No |
| API Access | Yes | No |
| Custom Plugins | Yes | No |
| App Exclusions | User controlled | Apps can force-block |

**Screenpipe's Verdict**: "Microsoft Recall is a built-in Windows feature that captures screenshots for AI-powered search. However, it only works on specific Copilot+ PCs running Windows 11, has faced significant privacy controversies, and offers no audio capture. Screenpipe works on any Mac, Windows, or Linux machine, captures both screen and audio, and gives you complete control over your data as open-source software."

**Key Insight**: Platform lock-in (Win 11 only), no audio, privacy backlash at launch, apps can block capture.

**Escribano Differentiation**: Recall captures screenshots; Escribano captures understanding. Recall has no audio; Escribano transcribes and aligns audio. Recall is Windows-only; Escribano is session-based anywhere.

---

### 3.4 ScreenMemory

**Tagline**: "Mac-only screen recording with OCR search"

| Feature | Screenpipe | ScreenMemory |
|---------|-----------|-----------|
| Open Source | Yes | No |
| Platform | Mac, Win, Linux | Mac only |
| Code Transparency | 100% auditable | Closed-source black box |
| Audio Recording | Yes | No |
| API Access | Yes | No |
| Plugin System | Yes | No |
| Multi-Monitor | Yes | Pro only ($27) |
| AI Chat | Yes | No |
| Development Activity | 50+ updates/week | Infrequent updates |

**Screenpipe's Verdict**: "ScreenMemory is a simple Mac-only screen recording tool with OCR search. However, it's completely closed-source, so you have no way to verify what's happening with your data. It lacks audio recording, has no API, no AI chat, no LLM integrations, and only works on Mac with infrequent updates. Screenpipe is fully open-source with 50+ updates per week, works on Mac, Windows, and Linux, captures both screen and audio, includes AI chat with Claude/OpenAI/Ollama integrations, and gives developers full API access."

**Key Insight**: Closed-source Mac-only screenshot tool. No audio, no AI, no API. Single developer, infrequent updates.

**Escribano Differentiation**: ScreenMemory is storage with search; Escribano is intelligence with documentation. ScreenMemory captures screenshots; Escribano captures activities.

---

### 3.5 Granola

**Tagline**: "AI meeting notepad"

| Feature | Screenpipe | Granola |
|---------|-----------|-----------|
| Open Source | Yes | No |
| Platform | Mac, Win, Linux | Mac, Win, iOS |
| Capture Scope | 24/7 everything | Meetings only |
| Screen Recording | Yes | No |
| Audio Recording | 24/7 | Meetings only |
| Data Storage | 100% local | Cloud-based |
| API Access | Yes | No |
| Local AI | Yes | Cloud only |
| Works Without Google | Yes | No (requires Google Workspace) |

**Screenpipe's Verdict**: "Granola is a polished meeting notes tool that excels at its narrow focus - capturing and summarizing meetings. However, it only works during meetings and requires Google Workspace. Screenpipe captures your entire digital life 24/7, not just meetings. If you only need meeting notes, Granola works. If you want comprehensive memory with the flexibility to build on top of it, Screenpipe is the choice."

**Key Insight**: Meeting-only, Google Workspace required, cloud-only. Best-in-class for meetings but nothing else.

**Escribano Differentiation**: Granola works during meetings; Escribano works during deep work. Granola requires Google; Escribano works with any session. Granola produces meeting notes; Escribano produces activity documentation.

**Meeting Assistant Insight**: Granola's #1 selling point is "no bot in calls" — people communicate differently when observed.

---

### 3.6 Remio

**Tagline**: "AI second brain for web content and files"

| Feature | Screenpipe | Remio |
|---------|-----------|-----------|
| Open Source | Yes | No |
| Platform | Mac, Win, Linux | Mac only (Apple Silicon) |
| Screen Recording | 24/7 all monitors | No (web only) |
| Audio Recording | Yes | No |
| Desktop App Capture | Yes | No |
| Data Storage | 100% local | Local + optional cloud |
| API Access | Yes | No |
| Custom Plugins | Yes | No |
| Local AI | Yes | No |

**Screenpipe's Verdict**: "Remio is a solid tool for saving web articles and organizing documents, but it only captures what you explicitly browse - missing everything else. No screen recording means no capturing that Figma design, code editor, or desktop app. No audio means no meeting transcriptions. Mac-only (Apple Silicon only) limits your options. Screenpipe captures everything on all your screens plus audio."

**Key Insight**: Web clipping tool only. No screen recording, no audio, M1+ Mac only. Chrome extension based.

**Escribano Differentiation**: Remio captures what you browse; Escribano captures what you do. Remio is manual (save articles); Escribano is automatic (session processing).

---

### 3.7 ChatGPT Memory

**Tagline**: "OpenAI's conversation memory feature"

| Feature | Screenpipe | ChatGPT Memory |
|---------|-----------|-----------|
| Context Source | Screen + audio + OCR | Chat conversations only |
| Screen Recording | Yes | No |
| Audio Capture | Yes | No |
| Data Storage | 100% local | OpenAI cloud |
| Open Source | Yes | No |
| Works with Any AI | Yes (Claude, Gemini, Ollama) | ChatGPT only |
| Offline Support | Yes | No |

**Screenpipe's Verdict**: "ChatGPT Memory now remembers saved facts AND references your past chat history. That's useful for personalization - but it only knows what you've typed in ChatGPT. It can't see your screen, hear your meetings, or know what you're working on outside of chat. Screenpipe captures everything: screen recordings, audio transcriptions, OCR'd text."

**Key Insight**: Conversation memory only — no screen awareness, no audio, cloud-only.

**Escribano Differentiation**: ChatGPT Memory personalizes chats; Escribano documents work sessions. They're complementary. Escribano could feed context TO ChatGPT.

---

### 3.8 Claude App

**Tagline**: "Anthropic's official AI assistant app"

| Feature | Screenpipe | Claude App |
|---------|-----------|-----------|
| Screen Memory | 24/7 continuous | None |
| Audio Recording | Yes | No |
| Search Past Activity | Yes | No |
| Open Source | Yes | No |
| Local Processing | Yes | Cloud only |
| MCP Integration | Provides tools to Claude | Consumes MCP tools |
| Works Offline | Yes | No |

**Screenpipe's Verdict**: "Claude App is excellent for conversations, but Claude only knows what you tell it. It can't see your screen, remember your meetings, or recall that error you saw yesterday. Screenpipe fills this gap - it records your screen 24/7 and gives Claude (via MCP) access to search your complete history."

**Key Insight**: Claude is incredibly smart but conversation-only. No screen awareness without MCP tools.

**Escribano Differentiation**: Screenpipe gives Claude raw screen data; Escribano could give Claude pre-segmented, structured TopicBlocks. Much more useful for Claude to query "what did I debug this week?" than raw OCR.

---

### 3.9 Clawdbot (Moltbot)

**Tagline**: "Self-hosted AI agent with computer control"

| Feature | Screenpipe | Clawdbot |
|---------|-----------|-----------|
| Primary Function | Screen memory + search | Computer control via chat |
| Screen Memory | 24/7 continuous | None |
| Computer Control | No | Yes |
| Audio Recording | Yes | No |
| Open Source | Yes | Yes |
| Self-Hosted | Yes | Yes |
| Data Storage | 100% local | 100% local |

**Screenpipe's Verdict**: "Clawdbot and Screenpipe solve completely different problems. Both are open-source and self-hosted. Clawdbot controls your computer via chat commands - run scripts, browse web, manage files. Screenpipe is a memory layer: it records your screen 24/7 and makes everything searchable. They're complementary: use Clawdbot to act, use screenpipe to remember."

**Key Insight**: Different use cases — Clawdbot acts, Screenpipe remembers. 60k+ GitHub stars.

**Escribano Differentiation**: Clawdbot controls; Escribano documents. Complementary. Escribano could integrate with Clawdbot for "act on what you did" workflows.

---

### 3.10 Otter.ai

**Tagline**: "AI meeting notetaker and transcription service"

| Feature | Screenpipe | Otter.ai |
|---------|-----------|-----------|
| Open Source | Yes | No |
| What Gets Captured | Screen (OCR) + all audio 24/7 | Meeting audio only |
| Data Storage | 100% local | Cloud (Otter's servers) |
| Platform | Mac, Win, Linux | Web, Desktop, iOS, Android, Chrome |
| Screen Recording | Yes | No |
| Audio Transcription | All audio, unlimited | Meetings only, 6000 min/mo cap |
| AI Model Choice | Any model (Claude, Gemini, Ollama) | Otter's built-in AI only |
| Developer API | Full REST API + MCP | Limited, paid plans only |
| Works Without Internet | Yes | No |
| Pricing | $400 lifetime | $19.99/user/mo (Business) |

**Screenpipe's Verdict**: "Otter.ai is excellent at what it does — meeting transcription with AI summaries and action items. But it only captures meetings. The other 90% of your workday — browsing, coding, reading, Slack conversations, emails — is invisible to Otter. Screenpipe captures everything on your screen 24/7, transcribes all audio (not just meetings), and keeps 100% of your data local."

**Key Insight**: Meeting-only ($19.99/user/mo), cloud-only, 6000 min/mo cap. No screen capture at all.

**Cost at Scale**: Team of 10 = $200/mo = $2,400/yr vs Screenpipe one-time $400.

**Escribano Differentiation**: Otter captures meeting audio; Escribano captures session activities. Otter transcribes talking; Escribano understands working.

---

### 3.11 tl;dv

**Tagline**: "AI meeting notetaker for Zoom, Google Meet, and Teams"

| Feature | Screenpipe | tl;dv |
|---------|-----------|-----------|
| Open Source | Yes | No |
| What Gets Captured | Screen (OCR) + all audio 24/7 | Meeting video and audio only |
| Data Storage | 100% local | Cloud (tl;dv servers) |
| Platform | Mac, Win, Linux | Web + browser extension |
| Screen Recording | Yes | Meeting screen share only |
| OCR | Yes | No |
| Audio Transcription | All audio, unlimited, local | Meeting audio only, cloud |
| CRM Integration | Via API + MCP (any CRM) | HubSpot, Salesforce native |
| Developer API | Full REST API + MCP | No |
| Works Without Internet | Yes | No |

**Screenpipe's Verdict**: "tl;dv is a solid meeting recorder with strong CRM integrations — great for sales teams who need meeting notes pushed to HubSpot or Salesforce. But like other meeting tools, it only sees your calls. Screenpipe captures your full screen 24/7, transcribes all audio, runs 100% locally, and is fully open source."

**Key Insight**: Meeting-only with polished CRM integrations. Cloud-only, no API, browser-based.

**Escribano Differentiation**: tl;dv pushes meetings to CRM; Escribano documents work sessions. Different market (sales vs developers).

---

### 3.12 Pieces for Developers

**Tagline**: "Long-term memory and context management for developer workflows"

| Feature | Screenpipe | Pieces |
|---------|-----------|-----------|
| Open Source | Fully open (MIT) — 16,600+ stars | Partially open (some SDKs/plugins) |
| What Gets Captured | Screen + app + keyboard + clipboard + mouse + audio | Code snippets in IDE plugins only |
| Screen Recording & OCR | Continuous + text extraction | No |
| Audio & Meeting Transcription | Local Whisper + speaker ID | No |
| Automatic Capture | Always on — zero manual | Manual save or tool integration |
| Data Storage | 100% local by default | Local with optional cloud sync |
| IDE Integration | MCP server (any AI tool) | Native plugins (VS Code, JetBrains, Obsidian, Chrome) |
| Visual Timeline | Full visual timeline | No |
| Search Scope | Every app, window, audio | Code and context within integrated tools |
| Developer API | Full REST API + MCP + TypeScript SDK | SDK and plugin integrations |
| Agentic Workflows | Pipes — AI agents that act | No |

**Screenpipe's Verdict**: "Pieces is a solid developer tool — great snippet management, polished IDE plugins, and a decent AI copilot for your editor. If all you need is a smart code clipboard inside VS Code, it does that well. But it only lives inside your IDE. No screen capture, no audio, no keyboard or clipboard tracking. It can't see your browser, Slack, terminal, or anything outside editor plugins. Screenpipe captures your entire computer."

**Key Insight**: Excellent IDE integration but IDE-only. No screen, no audio, requires manual saving. Polished but limited scope.

**Escribano Differentiation**: Pieces captures saved code snippets; Escribano captures entire work sessions. Pieces is manual (save what you know you'll need); Escribano is automatic (captures what you didn't think to save).

**Critical Quote**: "Your IDE is 40% of your day. Developers spend more time reading docs, reviewing PRs, chatting on Slack, and joining meetings than actually writing code."

---

### 3.13 Omi

**Tagline**: "AI wearable + desktop app with cloud processing"

| Feature | Screenpipe | Omi |
|---------|-----------|-----------|
| Data Storage | 100% local | Cloud servers |
| Screen Recording | 24/7 all monitors — OCR + app + keyboard + clipboard + mouse | Screenshots with OCR only, cloud-processed |
| App Content Reading | Reads content directly from every app | No |
| Audio Recording | System audio + mic, local processing | Pendant mic + desktop, cloud processing |
| Open Source | Yes | Partial (firmware open, AI cloud-dependent) |
| Local AI / LLM | Ollama + Apple Intelligence + Windows AI | None — cloud only |
| Keyboard & Clipboard Capture | Full keyboard input + clipboard history | No |
| CPU Efficiency | Low — smart capture | High — screenshot-only is CPU-hungry |
| API Access | Full REST API + MCP | No |
| Multi-Device Sync | Encrypted sync across all devices | Cloud-only (data leaves device) |

**Screenpipe's Verdict**: "Omi has an interesting idea — a wearable pendant plus a desktop app for screen capture. But the execution raises questions. Your screenshots and audio get uploaded to their cloud servers for processing. There's no local AI option, no way to run offline, and no way to verify what happens to your data since the AI pipeline is proprietary. The screen capture itself is basic — just OCR on screenshots, which misses most of what you do and uses a lot of CPU. Screenpipe takes a fundamentally different approach: everything stays on your machine."

**Key Insight**: Wearable pendant ($89) but cloud-dependent, no local AI, no API. Screen data travels to OpenAI and Deepgram.

**Escribano Differentiation**: Omi uploads to cloud; Escribano processes locally. Omi takes screenshots; Escribano understands activities.

---

## 4. Master Feature Comparison Matrix

| Feature | Screenpipe | Littlebird | Limitless | Recall | ScreenMemory | Granola | Remio | ChatGPT | Claude | Clawdbot | Otter | tl;dv | Pieces | Omi |
|---------|-----------|-----------|-----------|--------|-------------|---------|-------|---------|--------|----------|-------|-------|--------|-----|
| **Open Source** | Yes | No | No | No | No | No | No | No | No | Yes | No | No | Partial | Partial |
| **Platform** | Mac/Win/Lin | Mac | Mac/Win/iOS | Win11 | Mac | Mac/Win/iOS | Mac | Web | Multi | Docker | Multi | Web | Mac/Win/Lin | Mac/Win/iOS |
| **Data Storage** | 100% local | Local+Cloud | Cloud | Local | Local | Cloud | Local+Cloud | Cloud | Cloud | Local | Cloud | Cloud | Local+Cloud | Cloud |
| **Screen Recording** | Yes (video) | No | Limited | Screenshots | Yes (OCR) | No | No | No | No | No | No | Meetings only | No | OCR only |
| **Audio Recording** | 24/7 all audio | Meetings | Yes | No | No | Meetings only | No | No | No | No | Meetings only | Meetings only | No | Yes |
| **API Access** | Full REST + MCP | No | No | No | No | No | No | No | No | No | Limited paid | No | SDK | No |
| **Local AI Support** | Yes (Ollama) | Cloud only | Cloud only | No | No | Cloud only | No | No | No | Yes | No | No | Yes | No |
| **Cross-Platform** | Yes | Mac only | Mac/Win | Win only | Mac only | Mac/Win | Mac only | Web | Multi | Docker | Multi | Web | Yes | Mac/Win/iOS |
| **Works Offline** | Yes | Limited | No | Yes | Yes | No | Limited | No | No | Yes | No | No | Partial | No |
| **Segmentation** | Flat timeline | No | No | No | No | Meeting-based | No | No | No | No | Meeting-based | Meeting-based | No | No |
| **Activity Types** | No | No | No | No | No | No | No | No | No | No | No | No | No | No |
| **Developer Focus** | Yes (API) | No | No | No | No | No | No | No | No | Yes | No | No | Yes | No |
| **Pricing** | $400 lifetime | ? | Subscription | Free | One-time | Subscription | ? | Subscription | Free tier | Free | $20/mo | ? | $35/mo | Hardware |
| **Hardware Required** | No | No | Pendant | Copilot+ PC | No | No | M1+ Mac | No | No | No | No | No | No | Pendant |
| **Privacy Model** | Auditable | Closed | Closed | Closed | Closed | Cloud | Closed | Cloud | Cloud | Auditable | Cloud | Cloud | Partial | Closed AI |
| **Intelligence Layer** | External (pipes) | Cloud | Cloud | Cloud | None | Cloud | Cloud | Cloud | Cloud | Self-hosted | Cloud | Cloud | Local | Cloud |

---

## 5. Screenpipe's Comparison Strategy Analysis

### 5.1 Their Positioning Playbook

Screenpipe's 13 comparison pages follow a consistent template:

**1. Feature Table (Always Wins On):**
- Local storage (✓)
- Open source (✓)
- API access (✓)
- Multi-platform (✓)

**2. Privacy Scare:**
- "Where does your data go?"
- "Your data travels through third-party services"
- "Companies see everything"

**3. Capture Depth:**
- "5-layer capture vs screenshots"
- "Screen recording + OCR + app content + keyboard + clipboard + mouse"
- "Audio + video, not just screenshots"

**4. Social Proof CTAs:**
- "Ask any AI to compare the codebases"
- Links to ChatGPT/Claude/Perplexity with pre-written comparison prompts

### 5.2 What They Never Claim

Screenpipe's comparison pages explicitly do NOT claim:

| What Screenpipe Doesn't Claim | Why It Matters |
|------------------------------|----------------|
| Better summaries or understanding | They don't do intelligence, just capture |
| Activity-aware segmentation | Flat timeline only |
| Structured output from work sessions | No artifact generation built-in |
| Quality of intelligence | Not in their value proposition |
| Cross-session context | Flat tables, no relationships |
| Activity classification | No concept of "debugging vs coding" |

**The Core Insight**: Screenpipe records everything and exposes raw data. Any intelligence must be added by the consumer (pipes, MCP tools, external integrations). This is the "intelligence burden" they place on developers building on top of their platform.

---

## 6. The Intelligence Gap (Core Insight)

### 6.1 The Core Problem

> **"The intelligence burden is on the consumer."**

Screenpipe records everything and exposes:
- Raw OCR text from frames
- Audio transcripts
- Timestamps
- App/window metadata

Any tool that wants to *understand* what happened must independently solve:

1. **Segmentation**: Divide flat timeline into meaningful chunks
2. **Activity Classification**: Distinguish debugging from coding from research
3. **OCR Uniformity Problem**: Code screens all look similar to text similarity
4. **Whisper Hallucinations**: Filter garbage from silent periods
5. **Structured Output**: Produce useful artifacts from raw data

**Result**: Every screenpipe pipe author, every MCP consumer, every developer building on screenpipe hits these exact problems independently.

### 6.2 Why OCR-Based Clustering Fails for Developer Work

**Proven by Escribano ADR-005 (2026-01-22):**

| Metric | Expected | Actual (V2) |
|--------|----------|-------------|
| Visual observations | 1,776 | 1,776 |
| Visual clusters | 5-15 segments | **1 giant blob** |
| Contexts extracted | ~20 useful | **746 garbage** |
| Topic blocks | Multiple | **1** |

**Root Causes:**

1. **OCR Text Similarity is Too Uniform**
   ```
   All code screens produce similar OCR:
   ["const", "function", "import", "return", "export", ...]
   
   → Text embeddings cluster together (high cosine similarity)
   → 1776 frames → 1 cluster
   ```

2. **OCR Regex Extracts Garbage**
   ```
   Version numbers parsed as URLs: "0.667", "0.984", "1.2.3"
   Filenames parsed as URLs: "0001.jpg", "index.ts"
   Timestamps parsed: "00.49.15", "32.972401z"
   
   → 746 "URL" contexts created (garbage)
   ```

3. **Semantic Merge ≠ Contextual Relevance**
   ```
   YouTube video about "car subscriptions" playing in background
   Similarity score with debugging session: 0.628
   
   → Merged into same TopicBlock (makes no sense)
   ```

**User Insight** (that led to VLM-first):
> "Why not just detect big screen changes and put all together, then batch to the VLM? Do we truly need OCR? It's adding a lot of entropy."

### 6.3 What Works Instead: VLM-First Processing

**Vision models understand:**
- "debugging in Terminal" vs 
- "reading docs in Chrome" vs
- "in a Zoom meeting" vs
- "writing code in VS Code"

**From screenshots** — something OCR text embeddings cannot distinguish.

**ADR-005 Solution Summary:**

| Aspect | V2 (Failed) | V3 (VLM-First) |
|--------|-------------|----------------|
| Primary signal | OCR text | VLM visual understanding |
| Segmentation | Embedding clustering | Activity continuity from VLM |
| Audio alignment | Semantic similarity merge | Temporal alignment only |
| OCR usage | Clustering + context extraction | Deferred to artifact generation |
| Embeddings | Required for clustering | Disabled (future semantic search) |
| Processing time | ~25 min | ~1 min |
| Segment quality | 1 blob | 5-15 expected |

---

## 7. Escribano vs Screenpipe: Detailed Comparison

### 7.1 Philosophy & Value Proposition

| Dimension | Screenpipe | Escribano |
|-----------|-----------|-----------|
| **Philosophy** | Data platform | Domain application |
| **Core value** | Raw data availability + search | Intelligence quality per session |
| **Primary question answered** | "What was on my screen?" | "What was I doing?" |
| **Success metric** | Capture completeness | Artifact usefulness |

### 7.2 Capture Model

| Dimension | Screenpipe | Escribano |
|-----------|-----------|-----------|
| **Capture** | Built-in Rust (full control) | Delegates to Cap (less control, focus on intelligence) |
| **Recording model** | Continuous 24/7, always-on daemon | Session-based, process after recording |
| **Trigger** | Always running | Explicit recording (Cap integration) |
| **Storage strategy** | MP4 segments + OCR index | Extract frames from Cap MP4, store sampled frames |

### 7.3 Processing Pipeline

| Dimension | Screenpipe | Escribano |
|-----------|-----------|-----------|
| **Processing** | OCR on every frame at capture time | VLM on ~25% of sampled frames, post-capture |
| **Primary signal** | OCR text (searchable tokens) | VLM descriptions (semantic understanding) |
| **Frame reduction** | None (all frames OCR'd) | Adaptive sampling: 10s base + gap fill → ~25% of frames |
| **Batching** | N/A (per-frame OCR) | 10 images per VLM request (sequential, not parallel) |

### 7.4 Segmentation & Understanding

| Dimension | Screenpipe | Escribano |
|-----------|-----------|-----------|
| **Segmentation** | None — flat timeline, search-based | Activity continuity → TopicBlocks (5-15/hour) |
| **Activity types** | No classification | 7 types: debugging, coding, meeting, reading, research, terminal, other |
| **Granularity** | Frame-level (1776 frames/hour) | Segment-level (5-15 TopicBlocks/hour) |
| **Understanding depth** | Text tokens | Semantic descriptions of activities |

### 7.5 Audio Processing

| Dimension | Screenpipe | Escribano |
|-----------|-----------|-----------|
| **Audio pipeline** | Direct Whisper, speaker ID | Silero VAD → Whisper → hallucination filter → temporal alignment |
| **VAD preprocessing** | No | Yes (3-layer pipeline) |
| **Hallucination handling** | Speaker ID only | Thresholds + post-filtering |
| **Alignment with visual** | No explicit alignment | Temporal alignment only (no semantic merge) |

### 7.6 Data Model

| Dimension | Screenpipe | Escribano |
|-----------|-----------|-----------|
| **Data model** | Flat tables + FTS5 (simple, no relationships) | 4 aggregate roots, normalized (Recording → Observation → Context → TopicBlock → Artifact) |
| **Cross-recording** | Not possible natively | Context entity spans recordings by design |
| **Relationships** | None (search only) | Rich: Recordings have Observations, Observations have Contexts, Contexts have TopicBlocks |

### 7.7 AI & Intelligence

| Dimension | Screenpipe | Escribano |
|-----------|-----------|-----------|
| **AI role** | External / pluggable (pipes, MCP consumers) | Core to pipeline (VLM + LLM built-in) |
| **Intelligence location** | Consumer adds it | Built into data model |
| **Activity classification** | None | VLM-driven segmentation |
| **Artifact generation** | Via pipes (external) | Built-in LLM summary generation |

### 7.8 Output & Artifacts

| Dimension | Screenpipe | Escribano |
|-----------|-----------|-----------|
| **Output** | Search results (text fragments + timestamps) | Narrative artifacts (markdown summaries) |
| **Artifact types** | Via pipes (configurable) | Summary (expandable to: standup, PR description, runbook) |
| **Structured data** | No | TopicBlocks with classification JSON |
| **Cross-session queries** | Impossible | Designed for: "all debugging sessions this week" |

### 7.9 Extensibility & Integration

| Dimension | Screenpipe | Escribano |
|-----------|-----------|-----------|
| **Extensibility** | Outward: REST API + MCP + Pipes + Store | Inward: Ports & Adapters (swap components) |
| **Plugin ecosystem** | Pipes marketplace (Stripe monetization) | None (core functionality focus) |
| **MCP integration** | Provides tools to consumers | Should add: exposes TopicBlocks + Contexts |
| **API design** | REST on localhost:3030 | Repository pattern, internal first |

### 7.10 Platform & Scope

| Dimension | Screenpipe | Escribano |
|-----------|-----------|-----------|
| **Platform** | macOS + Windows + Linux | macOS only (via Cap) |
| **Target user** | Power users, developers, anyone | Developers, knowledge workers |
| **Recording scope** | 24/7 everything | Explicit sessions |

### 7.11 Documentation & Architecture

| Dimension | Screenpipe | Escribano |
|-----------|-----------|-----------|
| **Architecture docs** | Implicit in code | ADR chain (001-005), architecture.md, AGENTS.md |
| **Engineering rigor** | 92 contributors, organic growth | Documented decisions, intentional design |
| **Open questions** | Unclear | Documented in ADRs |

### 7.12 Pricing

| Dimension | Screenpipe | Escribano |
|-----------|-----------|-----------|
| **Pricing** | $400 lifetime (platform) | TBD (open source CLI + future cloud) |
| **Open source** | Core engine (MIT) | Full codebase (intended) |
| **Monetization** | Lifetime licenses + Pro subscription | Likely: Cloud inference + team features |

---

## 8. What Escribano Should Learn From Screenpipe

### 8.1 Steal These (High Priority)

| Feature | Why | Priority | Implementation Notes |
|---------|-----|----------|---------------------|
| **MCP server** | Expose TopicBlocks + Contexts via MCP. Claude could query "what did I debug this week?" with pre-segmented data. More useful than screenpipe's flat OCR. | **High** | Build `escribano-mcp` package. Tools: search-topic-blocks, get-context-history, generate-artifact. |
| **"Ask AI to compare" CTA** | Marketing confidence play. Link to ChatGPT/Claude with pre-written prompt comparing repos. ADR chain is your advantage. | **High** | Add to escribano.dev landing page. Pre-written prompt comparing Escribano vs Screenpipe codebases. |
| **MP4 storage strategy** | Keep Cap's original MP4 + frame index table instead of extracted PNGs. Better storage efficiency. | **Medium** | Store frame metadata (timestamp, path) instead of extracted images. Extract on-demand for VLM. |
| **Apple Vision for OCR** | If/when adding OCR at artifact time, use Apple Vision (macOS native) instead of Tesseract. Better quality, less post-processing. | **Medium** | Native Swift bridge or child process. Evaluate accuracy vs Tesseract. |
| **Compare pages (SEO)** | Build escribano.dev/compare/screenpipe, /compare/granola, etc. Each positions against specific gap. | **Medium** | Post-launch SEO play. Template: Feature matrix + "why we win" + proof points. |
| **SSE/real-time streams** | Lightweight API during recording for live monitoring. | **Low** | Post-launch. REST API + SSE endpoint for current session status. |

### 8.2 Don't Copy These

| Anti-pattern | Why Not | Escribano's Alternative |
|-------------|---------|------------------------|
| **Flat data model** | Screenpipe's lack of segmentation is a weakness, not feature. Search-only is limiting. | Keep relational model with TopicBlocks, Contexts, Observations. |
| **OCR as primary signal** | Proven failure for developer work (ADR-005). Text similarity collapses for code. | Stay VLM-first. OCR deferred to artifact generation if at all. |
| **Plugin marketplace (yet)** | Platform play requires scale. Adds complexity before product-market fit. | Focus on output quality, not ecosystem. Add plugins post-launch if needed. |
| **24/7 recording** | Session-based is correct for Escribano thesis. Less data, more understanding. Privacy surface smaller. | Keep explicit recording model. Quality over quantity. |

---

## 9. Positioning Strategy

### 9.1 Core Position Statement

```
Screenpipe = "I'll record everything and make it searchable."
Escribano  = "I'll watch you work, understand what you're doing, and write about it."
```

### 9.2 Competitive Framing

#### Against Screenpipe: "Raw Data vs Understanding"

> "Screenpipe records everything. Escribano understands what you did. OCR tells you what text was on screen. VLM tells you what you were doing."

**Proof Points:**
- ADR-005: OCR clustering → 1 blob. VLM → meaningful segments.
- Screenpipe gives you 1,776 frames to search; Escribano gives you 5-15 TopicBlocks describing your activities.
- Screenpipe: "Find that frame." Escribano: "Here's what you worked on."

#### Against Meeting Tools: "Silent Work Matters"

> "Your coding sessions aren't meetings. Granola/Otter need someone talking. Escribano works when you're silent."

**Proof Points:**
- Meeting tools capture 10-20% of workday. Escribano captures the other 80%.
- Debugging, research, coding — silent activities that disappear with meeting tools.
- "Meetings have Granola. Code has GitHub. But the 3 hours you spent debugging? That just... disappears."

#### Against the Gap: "Nobody Documents Deep Work"

> "Nobody documents deep work. Meetings have Granola. Code has GitHub. But the 3 hours you spent debugging? That just... disappears. Escribano is the first tool that watches deep work and writes about it."

### 9.3 Proof Points for Launch

| Claim | Evidence |
|-------|----------|
| VLM-first works | ADR-005 postmortem: OCR clustering produced 1 giant blob; VLM produces meaningful segments |
| Built for developers | Activity types: debugging, coding, research, terminal, review |
| Structured output | TopicBlocks + narrative artifacts, not search results |
| Cross-session context | Context entity spans recordings by design |
| Processing speed | ~6 min for 1hr recording (V3 pipeline) |
| Activity segmentation | 5-15 meaningful segments per hour |

### 9.4 Launch Distribution Ideas

| Channel | Action | Content |
|---------|--------|---------|
| **Hacker News** | Technical failure postmortem | "Why OCR-based screen intelligence fails for developers (and what works instead)" — link to ADR-005 |
| **r/LocalLLaMA** | VLM capabilities showcase | "VLM-first session intelligence — what qwen3-vl can do with your screen recordings" |
| **Screenpipe pipe** | Distribution hack | Ship Escribano intelligence as a screenpipe pipe. Use their 17k-star distribution. Funnel to standalone. |
| **ADR Series** | Engineering credibility | Publish ADRs as blog posts. Engineers respect documented decisions. |
| **Product Hunt** | Launch day | "The AI scribe for your coding sessions" — emphasize understanding over recording |
| **Twitter/X** | Before/after content | Side-by-side: screenpipe search results vs Escribano artifact for same session |

---

## 10. Roadmap Implications

### 10.1 Pre-Launch Focus (Artifact Quality)

The artifact is the product. If it's mediocre, nothing else matters.

**Known quality gaps to address:**

| Gap | Solution | Priority |
|-----|----------|----------|
| VLM → LLM handoff | If VLM descriptions too generic, LLM has nothing to synthesize | P0 |
| Missing OCR at artifact time | Descriptions are abstract ("debugging in terminal") vs concrete ("debugging TypeError in auth.ts") | P0 |
| Segmentation granularity | Too few blocks = flat narrative; too many = noise | P0 |
| Prompt template quality | `prompts/summary-v3.md` does enormous heavy lifting | P0 |

### 10.2 Near-Term (Post-Launch: 0-3 months)

| Feature | Why | Priority |
|---------|-----|----------|
| **OCR on keyframes** | Add actual code/commands/URLs to summaries | High |
| **Own capture via ScreenCaptureKit** | Apple framework, Swift bridge. Key feature: app/window metadata without VLM inference | High |
| **MCP server** | Expose TopicBlocks + Contexts via MCP. Claude queries pre-segmented data. | High |
| **Cross-recording queries** | "All debugging sessions this week" — validate Context design | Medium |
| **Multiple artifact formats** | Standup, PR description, runbook — configurable output | Medium |

### 10.3 Medium-Term (3-12 months)

| Feature | Why | Business Model |
|---------|-----|----------------|
| **Cloud inference** | Hosted VLM + LLM so users don't need beefy Mac | Subscription (commodity, low margin) |
| **Cross-device context graph** | Cloud Context entity across machines/weeks/projects | Subscription (sticky, differentiated) |
| **Team intelligence** | Aggregate TopicBlocks across people — "what did the team work on this sprint?" | Per-seat (enterprise money) |
| **Screenpipe integration** | Escribano as consumer of screenpipe API — gains cross-platform for free | Integration play |

### 10.4 Proposed Pricing Structure

| Tier | Model | Value | Target Price |
|------|-------|-------|--------------|
| **Open source CLI** | Free, bring-your-own-Ollama | Community building, trust, distribution | Free |
| **Cloud inference** | Subscription | Convenience — no local model management | $15-25/mo |
| **Cross-device context** | Subscription | Differentiated — persistent semantic graph | $15-25/mo |
| **Team/Enterprise** | Per-seat | Cross-person intelligence, compliance, audit | $25/user/mo |

**Pricing Benchmarks:**
- Granola: $10/mo (meeting intelligence)
- Otter: $20/mo (meeting transcription)
- Pieces: $35/mo (developer snippets)
- Screenpipe: $400 lifetime (raw data platform)

**Strategy**: Price above Granola ($10) because:
1. Higher compute cost (VLM is expensive)
2. Smaller TAM (developers, not everyone)
3. Higher value per user (session artifacts > meeting notes)
4. No direct competitor in "session intelligence" space

---

## 11. Open Questions

### 11.1 Strategic Decisions

- [ ] **Screenpipe pipe or standalone first?**
  - Pipe = instant distribution to 17k community
  - Standalone = cleaner positioning, no dependency

- [ ] **Artifact formats beyond summary?**
  - Standup format? PR description? Runbook?
  - Multiple artifacts per session or single configurable?

- [ ] **OCR at artifact time — yes/no?**
  - Adds concrete code/URLs to summaries
  - But increases complexity + compute
  - Alternative: rely on VLM descriptions only

- [ ] **Pricing: match Granola ($10) or premium?**
  - Higher compute cost argues for premium
  - But developer tools often have price ceiling

- [ ] **Cross-device context graph priority?**
  - This is the sticky, differentiated feature
  - But requires cloud + sync infrastructure
  - Build early or defer until PMF?

### 11.2 Technical Unknowns

- [ ] **VLM prompt consistency**: Is qwen3-vl-4b producing reliable, consistent descriptions?
- [ ] **Cap watcher reliability**: Is it robust enough for "just works" UX?
- [ ] **Frame sampling adequacy**: Does 10s base + gap fill capture all meaningful transitions?
- [ ] **Audio alignment precision**: Are word-level timestamps sufficient for temporal alignment?
- [ ] **Summary LLM quality**: Is qwen3:32b sufficient for high-quality narrative generation?
- [ ] **Multi-monitor handling**: How should split-screen be analyzed by VLM?

### 11.3 Market Validation

- [ ] **Developer willingness to pay**: Will developers pay $15-25/mo for session summaries?
- [ ] **Meeting tool competition**: Will teams use both Escribano + Granola, or is it either/or?
- [ ] **Screenpipe relationship**: Should we position as complement or competitor?
- [ ] **Distribution channels**: Is screenpipe pipe a viable distribution strategy?
- [ ] **Enterprise readiness**: What compliance/audit features needed for team/enterprise tier?

---

## 12. Appendices

### A. Research Sources

**Screenpipe Resources:**
- https://screenpi.pe/compare (main comparison page)
- https://screenpi.pe/compare/littlebird
- https://screenpi.pe/compare/limitless
- https://screenpi.pe/compare/microsoft-recall
- https://screenpi.pe/compare/screenmemory
- https://screenpi.pe/compare/granola
- https://screenpi.pe/compare/remio
- https://screenpi.pe/compare/chatgpt-memory
- https://screenpi.pe/compare/claude-app
- https://screenpi.pe/compare/clawdbot
- https://screenpi.pe/compare/otter-ai
- https://screenpi.pe/compare/tldv
- https://screenpi.pe/compare/pieces
- https://screenpi.pe/compare/omi

**Escribano Internal:**
- docs/adr/005-vlm-first-visual-pipeline.md
- docs/architecture.md
- docs/learnings.md

**Academic Research:**
- FOCUS: Frame-Optimistic Selection (arXiv:2510.27280) — <2% frame sampling
- PRISM: Label-guided Summarization (arXiv:2601.12243) — <5% frame retention
- Qwen3-VL Technical Report (arXiv:2410.12947) — Up to 128 frames in context

### B. Key Metrics Summary

| Metric | Screenpipe | Escribano V3 |
|--------|-----------|--------------|
| GitHub Stars | ~17k | N/A (pre-launch) |
| Contributors | 92 | 1 |
| Processing Time (1hr) | N/A (capture is real-time) | ~6 minutes |
| Frames Analyzed | 1,776/hour (OCR) | ~450/hour (VLM) |
| Data Model | Flat tables | 4 aggregate roots |
| Activity Types | None | 7 types |
| Artifacts | Via pipes | Built-in |
| Cross-Recording | No | Yes (Context entity) |

### C. Feature Gap Analysis

**What Escribano Has That Nobody Else Does:**

1. **Activity Segmentation**: Only Escribano classifies by activity type (debugging, coding, etc.)
2. **Structured Artifacts**: Only Escribano produces narrative summaries, not search results
3. **VLM-First Processing**: Screenpipe is OCR-first; Escribano is VLM-first (proven better)
4. **Cross-Session Context**: Context entity spans recordings by design
5. **ADR Discipline**: Documented architecture decisions (competitive asset)

**What Screenpipe Has That Escribano Needs:**

1. **MCP Server**: Screenpipe has this; Escribano should add it
2. **Cross-Platform**: Screenpipe is Mac/Win/Linux; Escribano is Mac-only
3. **Ecosystem**: 17k stars, marketplace, community
4. **24/7 Recording**: Always-on model (Escribano is session-based)
5. **Pipes System**: Plugin marketplace (not critical for Escribano)

### D. Competitive Response Matrix

**If competitor X does Y, Escribano responds with Z:**

| Competitor Action | Escribano Response |
|-------------------|-------------------|
| Screenpipe adds segmentation | Emphasize VLM-first vs OCR-first; activity types vs generic segments |
| Granola adds screen capture | Emphasize deep work (debugging, coding) vs meetings |
| Otter adds screen recording | Emphasize understanding vs transcription; artifacts vs search |
| Pieces adds session capture | Emphasize automatic vs manual; narrative vs snippets |
| Microsoft Recall improves | Emphasize macOS + understanding vs Windows-only screenshots |
| New VLM-first competitor | Emphasize ADR discipline, proven pipeline, focus on developer workflows |

---

*Document generated from competitive analysis session, 2026-02-22.*  
*For questions or updates, see Escribano project documentation.*
