# Escribano: Balanced Scorecard

> **Date**: 2026-02-22
> **Companion to**: COMPETITIVE-ANALYSIS-2026-02-22.md
> **Framework**: Kaplan & Norton Balanced Scorecard, adapted for pre-revenue open-source developer tool
> **Purpose**: Turn competitive intelligence into executable strategy with measurable outcomes across all four perspectives

---

## How This Connects to the Competitive Analysis

The competitive analysis answers: *"Where's the gap in the market?"*
This scorecard answers: *"Can we fill it, how will we know, and what do we need to get there?"*

```
┌─────────────────────────────────────────────────────────────────────┐
│                        STRATEGY MAP                                  │
│                                                                      │
│   VISION: The intelligence layer for developer work sessions         │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │  FINANCIAL                                                    │   │
│   │  "How do we sustain this?"                                    │   │
│   │  Revenue model · Unit economics · Runway                      │   │
│   └──────────────────────┬───────────────────────────────────────┘   │
│                          │ funds                                     │
│   ┌──────────────────────▼───────────────────────────────────────┐   │
│   │  CUSTOMER                                                     │   │
│   │  "Who do we serve and how do we win them?"                    │   │
│   │  Personas · Adoption · Retention · Value perception            │   │
│   └──────────────────────┬───────────────────────────────────────┘   │
│                          │ demands                                   │
│   ┌──────────────────────▼───────────────────────────────────────┐   │
│   │  INTERNAL PROCESSES                                           │   │
│   │  "What must we execute brilliantly?"                          │   │
│   │  Pipeline quality · Artifact quality · Distribution            │   │
│   └──────────────────────┬───────────────────────────────────────┘   │
│                          │ requires                                  │
│   ┌──────────────────────▼───────────────────────────────────────┐   │
│   │  LEARNING & GROWTH                                            │   │
│   │  "What capabilities do we need to build?"                     │   │
│   │  Solo-dev constraints · Tech assets · Moat deepening          │   │
│   └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. Financial Perspective

*"How do we become sustainable while staying open-source?"*

### 1.1 Current State

| Metric | Value | Notes |
|--------|-------|-------|
| Revenue | $0 | Pre-launch |
| Runway | Side project | New role starts March 2026, Escribano becomes nights/weekends |
| VLM inference cost (local) | $0 marginal | User provides hardware + Ollama |
| VLM inference cost (cloud) | TBD | qwen3-vl:4b per frame — need to benchmark |
| Pricing model | Undefined | Open source CLI free, cloud/team TBD |

### 1.2 Unit Economics Questions (Unanswered)

These need answers before setting cloud pricing:

| Question | Why It Matters | How to Answer |
|----------|---------------|---------------|
| What's the VLM cost per 1hr session (cloud)? | Determines minimum viable price for cloud tier | Benchmark qwen3-vl:4b inference on cloud GPU (e.g., RunPod, Modal). ~450 frames × inference cost/frame. |
| What's the LLM cost per artifact? | Adds to per-session cost | Benchmark qwen3:32b for summary generation. Single call, but 32B model isn't cheap. |
| What's the storage cost per user/month? | Matters for cloud tier | Estimate: ~10 sessions/week × frame data + SQLite rows. Likely negligible vs compute. |
| What margin does $15-25/mo give at 10 sessions/week? | Validates pricing or kills it | (Price - compute cost per session × sessions/month) / price |

### 1.3 Revenue Strategy Options

| Strategy | Timeline | Revenue Potential | Risk |
|----------|----------|-------------------|------|
| **Open source only** | Now | $0 (community building) | No sustainability |
| **GitHub Sponsors / Open Collective** | Launch | Low ($100-500/mo at best) | Unreliable |
| **Cloud inference subscription** | Post-launch (3-6 mo) | Medium ($15-25/user/mo) | Commodity — anyone can host VLMs |
| **Cross-device context graph** | 6-12 mo | Higher (sticky, differentiated) | Requires cloud infra investment |
| **Team/Enterprise** | 12+ mo | Highest ($25/seat/mo) | Requires multi-user features, compliance |

### 1.4 Financial KPIs

| KPI | Pre-Launch Target | 3-Month Target | 6-Month Target |
|-----|-------------------|----------------|----------------|
| GitHub stars | — | 500 | 2,000 |
| CLI downloads/installs | — | 200 | 1,000 |
| Cloud waitlist signups | — | 100 | 500 |
| Monthly revenue | $0 | $0 (still free) | First paying users |
| Cost per cloud session | Unknown | Benchmarked | Optimized |

### 1.5 Competitive Pricing Context

From the competitive analysis:

| Competitor | Price | What You Get | Escribano Implication |
|-----------|-------|-------------|----------------------|
| Screenpipe | $400 lifetime | Raw data platform | Escribano's cloud could be cheaper monthly, higher value per session |
| Granola | $10/mo | Meeting notes | Escribano delivers more (full sessions, not just meetings) — justify premium |
| Otter | $20/mo | Meeting transcription | Similar price range, but different market |
| Pieces | $35/mo | Developer snippets | Highest comp — developer willingness to pay exists at this level |

**Pricing hypothesis**: $15/mo for cloud inference, $25/mo for cross-device context. Test willingness-to-pay via waitlist survey before building cloud infra.

---

## 2. Customer Perspective

*"Who exactly are we serving, and how do they measure value?"*

### 2.1 The Persona Gap in the Competitive Analysis

The competitive analysis says "developers" 47 times but never defines who. This matters because different developers have radically different needs:

### 2.2 Primary Personas

#### Persona A: "The Solo Debugger" (Launch Target)

| Attribute | Detail |
|-----------|--------|
| **Who** | IC developer (mid to senior), works independently on complex codebases |
| **Pain** | Spends 2-4 hours debugging, can't reconstruct what they tried. Standup tomorrow asks "what did you do?" |
| **Current workaround** | Manual notes (forget), git log (incomplete), memory (unreliable) |
| **Job to be done** | "Help me remember and articulate what I did during my coding session" |
| **Artifact format needed** | Standup summary, personal work log |
| **Willingness to pay** | Medium ($10-20/mo) — it's a nice-to-have unless they feel accountability pressure |
| **Adoption friction** | QuickTime (built-in) + Ollama + Escribano. Two dependencies. Cap support exists but QuickTime is primary workflow. |
| **Success metric** | "I saved 15 minutes writing my standup and it was more accurate" |

#### Persona B: "The Tech Lead Documenter" (Near-Term)

| Attribute | Detail |
|-----------|--------|
| **Who** | Tech lead or senior IC who needs to document decisions, debug sessions, architecture explorations for team |
| **Pain** | Context gets lost between sessions. PR descriptions are shallow. Architecture decisions undocumented. |
| **Current workaround** | Loom recordings (long, unwatched), Notion docs (written after the fact, incomplete) |
| **Job to be done** | "Automatically document my technical work so my team has context" |
| **Artifact format needed** | PR description, technical decision log, session runbook |
| **Willingness to pay** | Higher ($20-35/mo) — documentation has team value |
| **Adoption friction** | Same as A, plus needs to trust output quality enough to share with team |
| **Success metric** | "My PR descriptions are better and I didn't write them manually" |

#### Persona C: "The Engineering Manager" (Medium-Term, Team Tier)

| Attribute | Detail |
|-----------|--------|
| **Who** | EM who wants visibility into what the team worked on without micromanaging |
| **Pain** | Standup is performative. Sprint retros lack specifics. Can't tell if someone is stuck. |
| **Current workaround** | Jira ticket updates (gamed), Slack messages (noisy), 1:1s (delayed) |
| **Job to be done** | "Understand what my team actually worked on without asking them" |
| **Artifact format needed** | Team activity dashboard, sprint summary, individual session logs |
| **Willingness to pay** | Highest ($25/seat/mo) — operational value |
| **Adoption friction** | Privacy concerns from ICs. "Is this surveillance?" Must be opt-in. |
| **Success metric** | "I know who's stuck before they tell me" |

### 2.3 Launch Persona Decision

**Recommendation: Launch for Persona A ("The Solo Debugger").**

Why:
- Simplest artifact format (standup / work log)
- Single user, no team features needed
- Privacy is non-issue (your own data, your own machine)
- Lowest quality bar (artifact just needs to be better than memory)
- Fastest feedback loop (1 person tests → 1 person reports)

Persona B is the growth target (higher WTP, team distribution). Persona C is the monetization target (per-seat).

### 2.4 Customer Value Chain

```
Competitive Analysis Gap    →    Escribano Feature         →    Customer Value
─────────────────────────────────────────────────────────────────────────────
Nobody segments dev work     →    TopicBlocks               →    "I can see what I did"
Nobody documents deep work   →    Narrative artifacts        →    "I can share what I did"
OCR fails for code sessions  →    VLM-first understanding   →    "It actually gets it right"
No cross-session context     →    Context entity             →    "I can track a bug across days"
Whisper hallucinates silence →    3-layer audio pipeline     →    "Audio doesn't produce garbage"
```

### 2.5 Customer KPIs

| KPI | Pre-Launch | 3-Month | 6-Month |
|-----|-----------|---------|---------|
| Active users (weekly) | 0 | 20 | 100 |
| Sessions processed per user/week | — | 3 | 5 |
| Artifact "usefulness" rating (1-5) | — | 3.5 | 4.0 |
| Retention (week 4) | — | 40% | 60% |
| NPS | — | Measure | > 30 |
| Organic referral rate | — | Measure | 10% |

### 2.6 Adoption Funnel

```
AWARENESS                    CONSIDERATION              ACTIVATION                RETENTION
─────────────────────────── ──────────────────────────── ─────────────────────── ────────────────
HN post (ADR-005)            README with before/after     Install Cap + Ollama    Artifact quality
r/LocalLLaMA                 2-min Loom demo              Run first session       < 10 min to value
Screenpipe pipe              Compare pages (SEO)          Process recording       Standup habit
ADR blog series              "Ask AI to compare" CTA      Read first artifact     Cross-session
Twitter before/after         GitHub stars as social proof  "This is useful"       context builds

METRIC: impressions          METRIC: GitHub visits        METRIC: first run      METRIC: week-4
                             README → install ratio       time-to-first-artifact  sessions > 0
```

**Critical insight from competitive analysis**: Screenpipe's biggest adoption barrier is setup complexity ($400 + 8GB RAM + configuration). Escribano has the same problem (Cap + Ollama + CLI). **The activation step is the riskiest part of the funnel.** Consider: one-line install script, or a "try with sample recording" mode that ships a demo session.

---

## 3. Internal Processes Perspective

*"What must we execute brilliantly to deliver the customer value?"*

### 3.1 Core Processes (Ranked by Impact on Customer Value)

| Process | Current State | Target State | Gap | Priority |
|---------|--------------|-------------|-----|----------|
| **Artifact generation quality** | Works but unvalidated | "Better than manual standup notes" | Unknown — need user testing | P0 |
| **VLM description consistency** | qwen3-vl:4b, untested at scale | Reliable activity classification on diverse screens | May need prompt tuning or model upgrade | P0 |
| **Segmentation precision** | 5-15 TopicBlocks/hour (designed) | Segments match human intuition of "what I worked on" | Untested with real users | P0 |
| **Installation / onboarding** | 3 dependencies (Cap + Ollama + CLI) | Under 5 minutes to first artifact | Currently unclear how long this takes | P1 |
| **Summary prompt template** | prompts/summary-v3.md exists | Produces narrative that reads like a human wrote it | Template quality unknown | P0 |
| **Audio hallucination filtering** | 3-layer pipeline built | Zero hallucinated segments in silent coding sessions | Battle-tested but edge cases unknown | P1 |
| **Distribution / awareness** | Zero | 500 GitHub stars, HN front page | Need launch content + timing | P1 |

### 3.2 The Artifact Quality Problem (From Competitive Analysis §10.1)

The competitive analysis identifies this as the blocker. Let's decompose it:

```
ARTIFACT QUALITY = f(VLM descriptions, Segmentation, Prompt template, OCR at artifact time)

              ┌─────────────────────────┐
              │   VLM Description        │
              │   Quality                │
              │   ─────────────────────  │
              │   Generic: "user is      │
              │   coding in editor"      │
              │   vs.                    │
              │   Specific: "debugging   │
              │   TypeError in auth.ts   │
              │   using Chrome DevTools" │
              └───────────┬─────────────┘
                          │ feeds into
              ┌───────────▼─────────────┐
              │   Segmentation          │
              │   Precision              │
              │   ─────────────────────  │
              │   3 giant blocks =       │
              │   "coded, then debugged" │
              │   vs.                    │
              │   12 precise blocks =    │
              │   "implemented auth →    │
              │    hit CORS error →      │
              │    researched on MDN →   │
              │    applied fix"          │
              └───────────┬─────────────┘
                          │ feeds into
              ┌───────────▼─────────────┐
              │   Summary Prompt         │
              │   Template               │
              │   ─────────────────────  │
              │   This does enormous     │
              │   heavy lifting. A bad   │
              │   prompt + good data =   │
              │   bad artifact. A good   │
              │   prompt + good data =   │
              │   the product.           │
              └───────────┬─────────────┘
                          │ optionally enriched by
              ┌───────────▼─────────────┐
              │   OCR at Artifact Time   │
              │   (Currently Deferred)   │
              │   ─────────────────────  │
              │   Adds: actual code,     │
              │   error messages, URLs,  │
              │   terminal commands      │
              │   Without: descriptions  │
              │   stay abstract          │
              └─────────────────────────┘
```

**Actionable next step**: Process 5 real sessions, read the artifacts, identify which layer is the bottleneck. Is the VLM too generic? Is segmentation too coarse? Is the prompt template the problem? You can't fix the right layer without diagnosing which one fails.

### 3.3 Process KPIs

| KPI | Current | Pre-Launch Target | 3-Month Target |
|-----|---------|-------------------|----------------|
| Artifact quality (self-assessed 1-5) | Unknown | 3.5 | 4.0 |
| Processing time (1hr session) | ~6 min | < 10 min | < 5 min |
| Segments per hour (average) | 5-15 (designed) | 5-15 (validated) | 8-12 (tuned) |
| VLM description specificity | Unknown | "Activity type correct >80%" | ">90%" |
| Audio hallucination rate | Low (designed) | < 1% of segments | < 0.5% |
| Time from install to first artifact | Unknown | < 15 min | < 10 min |
| Crash/failure rate | Unknown | < 5% of sessions | < 1% |

### 3.4 Process Innovation Pipeline

From competitive analysis §8.1 ("Steal These"):

| Innovation | Source | Process It Improves | When |
|------------|--------|--------------------|----- |
| Auto-process watcher | UX need | Removes manual CLI step | Pre-March (2-3h) |
| MCP server | Screenpipe | Distribution + integration | Post-launch (month 1-2) |
| MP4 storage (keep original) | Screenpipe | Storage efficiency | Post-launch |
| Apple Vision OCR | Screenpipe | Artifact specificity (OCR at artifact time) | Post-launch |
| Real-time capture pipeline | Architecture | Onboarding (always-on recording) | Month 3-6 | See `screen_capture_pipeline.md` |
| Compare pages | Screenpipe marketing | SEO / acquisition | Month 2-3 |

---

## 4. Learning & Growth Perspective

*"What capabilities and assets do we need, and what are our constraints?"*

### 4.1 Honest Capability Assessment

| Capability | Current State | Needed For Launch | Gap |
|-----------|--------------|-------------------|-----|
| **TypeScript/Node.js** | Strong (core codebase) | ✅ Sufficient | None |
| **DDD / Clean Architecture** | Strong (ADR chain proves it) | ✅ Sufficient | None |
| **VLM prompt engineering** | Untested at scale | Critical for artifact quality | **Need to validate** |
| **LLM prompt engineering** | prompts/summary-v3.md exists | Critical for output quality | **Need to validate** |
| **Marketing / positioning** | This document + competitive analysis | Need landing page + launch content | **Gap: execution time** |
| **Community management** | None | GitHub issues, Discord? | **Defer post-launch** |
| **Cloud infrastructure** | None | Not needed for launch | Defer |
| **Swift / ScreenCaptureKit** | Unknown | Not needed for launch | Defer |
| **Available hours/week** | Full-time (pre-March), then part-time | Enough for launch, tight for iteration | **Biggest constraint** |

### 4.2 The Solo Developer Constraint

This is the most important section in this entire scorecard.

**Reality**: Starting March, Escribano becomes a side project. That means:

| Constraint | Implication | Mitigation |
|-----------|-------------|------------|
| ~10-15 hrs/week max | Can't build MCP + own capture + cloud + team features simultaneously | Ruthless prioritization. One feature at a time. |
| No co-founder | No one to handle community, marketing, support while you code | Automate what you can. GitHub Discussions > Discord (async). |
| New job learning curve | March-April will be lowest bandwidth months | Launch BEFORE March. Don't expect iteration capacity until May. |
| Single point of failure | Sick week = no progress | Architecture already clean (Ports & Adapters). Others could contribute. |

**The honest launch scope for pre-March:**

```
MUST SHIP (this week)               NICE TO HAVE (post-launch)        DO NOT TOUCH (3+ months)
──────────────────────               ──────────────────────────        ────────────────────────
✅ CLI works (pnpm escribano)        MCP server                        Cloud inference
✅ MLX-VLM migration complete        Auto-process watcher              Team features
✅ VLM/LLM separation                Compare pages (SEO)               Cross-device context
⬜ Validate artifact quality (5 runs) Screenpipe pipe                   Plugin system
⬜ README with before/after           Real-time capture pipeline        Enterprise features
⬜ GitHub repo public + ADRs visible  Blog post series
⬜ Landing page (1-pager)
⬜ 2-min Loom demo
```

### 4.3 Moat Analysis (From Competitive Analysis, Extended)

The competitive analysis identifies Escribano's advantages but doesn't assess how durable they are:

| Advantage | Durability | Threat Timeline | Moat Deepening Strategy |
|-----------|-----------|----------------|------------------------|
| **VLM-first pipeline** | Medium (12-18 mo) | Screenpipe could add a VLM pipe within months. Any contributor could build it. | Move fast on quality. Ship before they think of it. ADR-005 blog post frames the narrative. |
| **Activity segmentation** | Medium (12-18 mo) | Conceptually simple. VLM + continuity grouping. Replicable. | Cross-recording Context entity is harder to replicate. Build the graph. |
| **TopicBlock data model** | High (18-24 mo) | Full DDD with 4 aggregate roots is harder to bolt onto a flat-table system. Screenpipe would need a rewrite. | Keep enriching the model. Add relations, queries, export formats. |
| **ADR discipline** | High (permanent) | Cultural asset. Can't be copied without doing the work. | Keep writing ADRs. They compound. Each one is a blog post. |
| **Artifact quality** | Low-Medium | Quality is prompt engineering + model choice. Both are replicable. | Quality comes from the full pipeline, not just the prompt. VLM → segmentation → LLM is a system, not a prompt. |
| **Cross-recording context** | High (18-24 mo) | Requires relational data model + designed-in entity. Very hard to retrofit. | **This is the real moat. Prioritize making it work well.** |
| **Whisper hallucination handling** | Medium | 3-layer pipeline is replicable but non-obvious. Most competitors don't even know they have this problem. | Document it. Blog about it. Make it table stakes that everyone measures against. |

**Bottom line**: The short-term moat is execution speed and narrative framing (ADR-005 blog post). The medium-term moat is the data model (TopicBlocks + Contexts spanning recordings). The long-term moat is the cross-device context graph if you get to cloud.

### 4.4 Knowledge Assets

| Asset | Type | Strategic Value |
|-------|------|----------------|
| ADR chain (001-005) | Documentation | Marketing + engineering credibility. Publish as blog series. |
| ADR-005 failure postmortem | Documentation | **Best single marketing asset.** "We tried the obvious thing, it failed, here's what works." |
| V2 → V3 evolution | Experience | Proof of iteration discipline. Competitive narrative: "We already made the mistakes so you don't have to." |
| Clean Architecture codebase | Code | Contributor-friendly. Ports & Adapters means new adapters are easy PRs. |
| This competitive analysis | Strategy | Living document. Update quarterly. |
| Balanced scorecard | Strategy | Execution tracking. Review monthly. |

### 4.5 Learning & Growth KPIs

| KPI | Pre-Launch | 3-Month | 6-Month |
|-----|-----------|---------|---------|
| ADRs written | 5 | 7 | 10 |
| Blog posts published | 0 | 3 (ADR-005, launch, architecture) | 6 |
| External contributors | 0 | 2 | 5 |
| Hours/week on Escribano | 30+ (pre-March) | 10-15 | 10-15 |
| Key skills acquired | — | VLM prompt tuning, basic marketing | Community mgmt, cloud infra |

---

## 5. Scorecard Summary: One-Page View

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ESCRIBANO BALANCED SCORECARD                              │
│                    Pre-Launch → 6 Months                                     │
├──────────────────────────────┬──────────────────────────────────────────────┤
│                              │                                              │
│  FINANCIAL                   │  CUSTOMER                                    │
│  ────────────────────────    │  ────────────────────────                    │
│  Objective: Validate unit    │  Objective: Prove value for                  │
│  economics, don't spend      │  "Solo Debugger" persona                     │
│  before validating           │                                              │
│                              │  Launch persona: Solo IC dev                 │
│  ☐ Benchmark cloud VLM cost  │  Job: "Remember & articulate my session"     │
│  ☐ Model cost/session        │  Success: "Saved 15 min on standup"          │
│  ☐ Validate $15-25/mo WTP    │                                              │
│  ☐ GitHub Sponsors setup     │  ☐ 20 weekly active users (3 mo)            │
│                              │  ☐ 3 sessions/user/week                     │
│  Target: $0 cost pre-launch  │  ☐ Artifact rating > 3.5/5                  │
│  (users bring own compute)   │  ☐ Week-4 retention > 40%                   │
│                              │                                              │
├──────────────────────────────┼──────────────────────────────────────────────┤
│                              │                                              │
│  INTERNAL PROCESSES          │  LEARNING & GROWTH                           │
│  ────────────────────────    │  ────────────────────────                    │
│  Objective: Artifact quality │  Objective: Maximize output                  │
│  is the product. Make it     │  within solo-dev constraints                 │
│  undeniably useful.          │                                              │
│                              │  Biggest risk: March role change             │
│  ☐ 5 real sessions processed │  = bandwidth drops to 10-15 hrs/wk          │
│  ☐ VLM accuracy > 80%       │                                              │
│  ☐ Install → first artifact  │  ☐ Ship before March                        │
│    < 15 min                  │  ☐ ADR-005 blog post (launch content)        │
│  ☐ 0% audio hallucinations   │  ☐ 2+ external contributors by month 3     │
│    in silent sessions        │  ☐ Moat: cross-recording Context works      │
│  ☐ Processing < 10 min/hr   │  ☐ Quarterly competitive analysis update    │
│                              │                                              │
└──────────────────────────────┴──────────────────────────────────────────────┘
```

---

## 6. Strategic Initiatives (Bridging Scorecard → Action)

### 6.1 Pre-March Sprint (THE Critical Window)

| Initiative | Scorecard Perspective | Effort | Impact | Do It? |
|-----------|----------------------|--------|--------|--------|
| Validate artifact quality (5 sessions) | Internal Process | 2-3 hours | Existential — the product IS the artifact | **YES, NOW** |
| README with before/after example | Customer (activation) | 2 hours | First impression for every GitHub visitor | **YES** |
| Make repo public | Customer (awareness) | 1 hour | Unlocks all distribution channels | **YES** |
| Landing page (single page) | Customer (awareness) | 3-4 hours | Needed for HN/Twitter links | **YES** |
| 2-min Loom demo | Customer (consideration) | 1 hour | Shows the product, not just describes it | **YES** |
| ADR-005 blog post | Learning & Growth | 2-3 hours | Best single marketing asset, drives HN traffic | **YES** |
| Benchmark cloud VLM cost | Financial | 2 hours | Informs all future pricing decisions | **IF TIME** |
| MCP server | Internal Process | 8-12 hours | High value but not launch-blocking | **NO — post-launch** |
| Own capture | Internal Process | 20+ hours | Removes Cap dependency but too much scope | **NO — month 3+** |

### 6.2 Initiative Prioritization (Effort vs Impact)

```
                        HIGH IMPACT
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        │  Validate quality │  MCP server       │
        │  README           │  Own capture      │
        │  Repo public      │  Cloud infra      │
        │  Landing page     │  Team features    │
        │  Loom demo        │                   │
        │  ADR-005 blog     │                   │
        │                   │                   │
LOW ────┼───────────────────┼───────────────────┼──── HIGH
EFFORT  │                   │                   │     EFFORT
        │                   │                   │
        │  GitHub Sponsors  │  Compare pages    │
        │  setup            │  Screenpipe pipe  │
        │                   │  Multiple formats │
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                        LOW IMPACT
```

**The pre-March sprint is everything in the top-left quadrant**: high impact, low effort. Everything else waits.

---

## 7. Risk Register

| Risk | Likelihood | Impact | Mitigation | Scorecard Link |
|------|-----------|--------|-----------|----------------|
| **Artifact quality is mediocre** | Medium | Critical | Process 5 real sessions NOW. Identify bottleneck layer. | Internal Process |
| **March bandwidth drop** | Certain | High | Ship everything possible before March. Minimize post-launch must-haves. | Learning & Growth |
| **Screenpipe adds VLM pipe** | Medium (6-12 mo) | High | Move fast. Establish narrative with ADR-005 blog. Build cross-recording moat. | Learning & Growth |
| **Cap dependency breaks** | Low-Medium | Medium | Monitor Cap releases. ScreenCaptureKit is the escape hatch (month 3+). | Internal Process |
| **qwen3-vl:4b insufficient** | Medium | High | Test with real sessions. Fallback: qwen3-vl:8b or qwen2.5-vl:7b. | Internal Process |
| **Nobody cares** | Medium | Critical | Validate with 5 real users before investing in cloud/team. ADR-005 blog tests market interest (HN upvotes). | Customer |
| **Onboarding too complex** | High | High | 3 dependencies is a lot. One-line install script. Sample recording for "try before you record." | Customer |

---

## 8. Monthly Review Cadence

**Suggested rhythm** (15 min/month, adjust as needed):

| Month | Focus | Key Question |
|-------|-------|-------------|
| **March** | Customer + Process | "Are the first 5 users finding artifacts useful?" |
| **April** | Process + Growth | "Which layer of the pipeline needs the most work?" |
| **May** | Financial + Customer | "Should I invest in cloud, or is local-only sufficient?" |
| **June** | All four | "Full scorecard review. Is this worth continuing at current pace?" |

---

*Companion document to COMPETITIVE-ANALYSIS-2026-02-22.md*
*Review cadence: Monthly. Next review: March 2026.*
