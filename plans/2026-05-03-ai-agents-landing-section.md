# Implementation Plan: AI Agents Landing Section

**Date**: 2026-05-03 **Status**: COMPLETED

## Overview

Add a dedicated landing-page section that explains why Escribano is useful for AI agents. The section will keep the existing terminal mock in the hero and the current How It Works cards, while giving the Remotion demo video a better home: an agent-focused explainer block with documentation links.

## Scope

- Work units: 2
- Execution phases: 1
- Files affected:
  - `apps/landing/layouts/index.html`
  - `apps/landing/assets/css/style.css`

## Work Units

### WU-1: Insert AI agents section markup

**Dependencies**: none

**Context**: The hero should stay as the animated terminal mock, and the How It Works step 03 should stay as the compact terminal card. The rendered video is too heavy for those placements, so it needs a dedicated explanatory section after How It Works and before Quick Start. This section should frame Escribano as a local evidence layer that lets Claude Code, Cursor, Codex, or other agents ask what happened outside the repository.

**Files**:
- `apps/landing/layouts/index.html` — modify

**Steps**:
1. Find the end of the How It Works section, immediately after this existing block:
   ```html
   </section>

   <section class="quick-start" id="quick-start">
   ```
2. Insert the new section between those two sections. Use this exact markup:
   ```html
   <section class="agent-section" id="agents">
     <div class="agent-inner">
       <div class="agent-copy fade-up">
         <div class="section-label">For AI agents</div>
         <h2>Give your agent a memory of what happened outside the repo.</h2>
         <p class="agent-lead">
           Your coding agent can inspect files and Git history. It cannot know what you saw, searched, debugged, or discussed unless that context is captured somewhere.
         </p>

         <div class="agent-points">
           <div class="agent-point">
             <div class="agent-point-label">Recover the trail</div>
             <p>Find the tools, timestamps, files, and screenshots behind a decision.</p>
           </div>
           <div class="agent-point">
             <div class="agent-point-label">Prime the next edit</div>
             <p>Pull relevant local context before Claude Code, Cursor, or Codex starts changing files.</p>
           </div>
           <div class="agent-point">
             <div class="agent-point-label">Cite the evidence</div>
             <p>Return structured moments an agent can quote without slurping raw screenshots by default.</p>
           </div>
         </div>

         <div class="agent-actions">
           <a href="/get-started/" class="btn-primary">Read the agent guide</a>
           <a href="https://docs.escribano.work" class="btn-ghost" target="_blank" rel="noopener">View docs <span>→</span></a>
         </div>
       </div>

       <div class="agent-demo fade-up" style="transition-delay: 0.12s">
         <div class="agent-video-frame">
           <div class="agent-video-label"><span class="q-dot"></span> capture → understand → query → cite</div>
           <video autoplay loop muted playsinline controls class="agent-video">
             <source src="/video/escribano-demo.mp4" type="video/mp4">
             Your browser does not support the video tag.
           </video>
         </div>
         <p class="agent-caption">A full local loop: screen moments become evidence your agent can ask for.</p>
       </div>
     </div>
   </section>
   ```
3. Do not change the hero section, the existing `how` section, `quick-start`, `product`, `personas`, or any Remotion files.
4. Keep the existing `Escrib<span>a</span>no` logo convention unchanged anywhere it appears; do not introduce any new logo markup in this section.

**Verification**: `grep -q 'id="agents"' apps/landing/layouts/index.html && grep -q '/video/escribano-demo.mp4' apps/landing/layouts/index.html && grep -q 'Read the agent guide' apps/landing/layouts/index.html`

**Rollback**:
- Modified files: `git checkout -- apps/landing/layouts/index.html`

### WU-2: Style the AI agents section

**Dependencies**: none

**Context**: The new section must match the existing landing design: serif headings, DM Sans labels, terracotta/amber accent, parchment/light theme support, dark-mode support, restrained borders, and the same button styles already used elsewhere. The CSS must style the class names introduced by WU-1 and make the video look intentional in a dedicated section rather than a misplaced hero asset.

**Files**:
- `apps/landing/assets/css/style.css` — modify

**Steps**:
1. In `apps/landing/assets/css/style.css`, add a new CSS block after the How It Works / step mock styles and before the existing `/* Quick start section */` comment.
2. Add styles for these selectors exactly: `.agent-section`, `.agent-inner`, `.agent-copy`, `.agent-copy h2`, `.agent-lead`, `.agent-points`, `.agent-point`, `.agent-point-label`, `.agent-point p`, `.agent-actions`, `.agent-demo`, `.agent-video-frame`, `.agent-video-label`, `.agent-video`, `.agent-caption`.
3. Use this exact CSS block:
   ```css
   /* ──────────────────────────────────────────────
      AI agents section
      ────────────────────────────────────────────── */
   .agent-section {
     background: var(--cream);
     border-top: 1px solid var(--parchment-deep);
     border-bottom: 1px solid var(--parchment-deep);
   }

   .agent-inner {
     max-width: 1180px;
     margin: 0 auto;
     display: grid;
     grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
     gap: 4rem;
     align-items: center;
   }

   .agent-copy { min-width: 0; }

   .agent-copy h2 {
     font-family: var(--serif);
     font-size: clamp(2.2rem, 4vw, 3.4rem);
     font-weight: 300;
     line-height: 1.12;
     letter-spacing: -0.01em;
     margin-bottom: 1.35rem;
     max-width: 12ch;
   }

   .agent-lead {
     font-family: var(--serif-body);
     font-size: 1.08rem;
     font-weight: 300;
     color: var(--ink-soft);
     line-height: 1.7;
     max-width: 42ch;
     margin-bottom: 2.25rem;
   }

   .agent-points {
     display: grid;
     gap: 1rem;
     margin-bottom: 2.25rem;
   }

   .agent-point {
     padding-left: 1rem;
     border-left: 2px solid var(--terracotta);
   }

   .agent-point-label {
     font-family: var(--sans);
     font-size: 0.72rem;
     font-weight: 600;
     letter-spacing: 0.12em;
     text-transform: uppercase;
     color: var(--terracotta);
     margin-bottom: 0.35rem;
   }

   .agent-point p {
     font-family: var(--serif-body);
     font-size: 0.98rem;
     font-weight: 300;
     color: var(--ink-soft);
     line-height: 1.55;
   }

   .agent-actions {
     display: flex;
     align-items: center;
     flex-wrap: wrap;
     gap: 1.25rem;
   }

   .agent-demo { min-width: 0; }

   .agent-video-frame {
     background: var(--ink);
     border-radius: 16px;
     overflow: hidden;
     box-shadow: 0 24px 70px rgba(26,22,18,0.22);
     border: 1px solid rgba(255,255,255,0.08);
   }

   :root.dark-mode .agent-video-frame {
     background: #07080c;
     box-shadow: 0 24px 70px rgba(0,0,0,0.45);
   }

   .agent-video-label {
     display: flex;
     align-items: center;
     gap: 0.6rem;
     padding: 0.85rem 1rem;
     font-family: var(--sans);
     font-size: 0.7rem;
     letter-spacing: 0.12em;
     text-transform: uppercase;
     color: rgba(245,240,232,0.62);
     border-bottom: 1px solid rgba(255,255,255,0.06);
   }

   .agent-video {
     display: block;
     width: 100%;
     aspect-ratio: 16 / 9;
     object-fit: cover;
     background: #050506;
   }

   .agent-caption {
     margin-top: 1rem;
     font-family: var(--sans);
     font-size: 0.78rem;
     color: var(--ink-muted);
     letter-spacing: 0.03em;
   }

   @media (max-width: 900px) {
     .agent-inner {
       grid-template-columns: 1fr;
       gap: 2.5rem;
     }

     .agent-copy h2 { max-width: 14ch; }
   }
   ```
4. Do not remove the existing `.use-term--step`, `.step-mock--query`, hero, How It Works, Quick Start, Product, Personas, Privacy, Pricing, or Footer styles.

**Verification**: `grep -q '.agent-section' apps/landing/assets/css/style.css && grep -q '.agent-video-frame' apps/landing/assets/css/style.css && grep -q '@media (max-width: 900px)' apps/landing/assets/css/style.css`

**Rollback**:
- Modified files: `git checkout -- apps/landing/assets/css/style.css`

## Execution Plan

### Phase 1 — Parallel (no dependencies)

- WU-1: Insert AI agents section markup
- WU-2: Style the AI agents section

## Recovery Strategy

- **Automatic**: Each implementor rolls back and retries once on failure.
- **Dependency failure**: There are no inter-work-unit dependencies; if one unit fails, the other can still complete.
- **Global rollback**: `git checkout -- apps/landing/layouts/index.html apps/landing/assets/css/style.css`
- **Independent failures**: Mark the failed work unit and keep successful changes only if they still make sense; otherwise roll back both landing files with the global rollback command.

## Final Verification

- Run `cd apps/landing && pnpm build` to confirm Hugo builds the page.
- Run `grep -q '/video/escribano-demo.mp4' apps/landing/layouts/index.html` to confirm the rendered Remotion video is referenced only in the new agent section.
