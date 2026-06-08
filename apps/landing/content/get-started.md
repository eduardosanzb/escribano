---
title: "Get Started"
date: 2026-04-09
draft: false
description: "Download and set up Escribano in three steps"
layout: "single"
---

<div class="install-intro">
  <p class="install-lede">Free: query your last <strong>7 days</strong> of history. A beta key unlocks unlimited history — <a href="/#beta">request one</a>, no payment required.</p>
  <p class="install-cta-wrap"><a class="install-cta" href="https://escribano.work/download">Download for macOS →</a></p>
  <p class="install-specs">Apple Silicon (M1+) · 16 GB RAM minimum · macOS 13 or later</p>
</div>

<ol class="install-steps">

<li class="install-step">
<div class="install-step-num" aria-hidden="true">1</div>
<div class="install-step-body">

<h2 class="install-step-title">Install</h2>
<p>Open the downloaded <code>.dmg</code> and drag <strong>Escribano</strong> into your <strong>Applications</strong> folder.</p>

<div class="install-drag" aria-hidden="true">
  <div class="install-drag-card">
    <div class="install-drag-icon">E</div>
    <div class="install-drag-label">Escribano</div>
  </div>
  <div class="install-drag-arrow">→</div>
  <div class="install-drag-card install-drag-card--folder">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
    </svg>
    <div class="install-drag-label">Applications</div>
  </div>
</div>

</div>
</li>

<li class="install-step">
<div class="install-step-num" aria-hidden="true">2</div>
<div class="install-step-body">

<h2 class="install-step-title">Grant Screen Recording</h2>
<p>Escribano will prompt you on first launch. Click <span class="install-btn-mock install-btn-mock--primary">Open System Settings</span>, then enable Escribano here:</p>

<div class="install-breadcrumb">
  <span class="install-crumb">System Settings</span>
  <span class="install-crumb-sep">›</span>
  <span class="install-crumb">Privacy &amp; Security</span>
  <span class="install-crumb-sep">›</span>
  <span class="install-crumb install-crumb--highlight">Screen Recording</span>
</div>

<p class="install-reassure">The app waits quietly until you grant this. Nothing is captured before.</p>

</div>
</li>

<li class="install-step">
<div class="install-step-num" aria-hidden="true">3</div>
<div class="install-step-body">

<h2 class="install-step-title">Start working</h2>
<p>Escribano captures your screen in the background. A small icon appears in your menu bar showing recording status.</p>

<div class="install-note install-note--ok">
  <strong>Everything stays local.</strong> Frames, transcripts, and your history never leave your machine.
</div>

</div>
</li>

</ol>

<section class="install-query">

<h2 class="install-query-title">Give your agents memory</h2>

<p>Escribano captures screen evidence in the background. Use the CLI directly, or give compact output to Claude Code, Codex, OpenCode, Cursor, or another local agent.</p>

<div class="install-query-examples">
  <div class="install-query-example">
    <code>escribano-query today --json</code>
    <span>See what happened today</span>
  </div>
  <div class="install-query-example">
    <code>escribano-query search "debugging" --since 1d</code>
    <span>Recover a work thread</span>
  </div>
  <div class="install-query-example">
    <code>escribano-query entities --kind software_tool</code>
    <span>Prime an agent with tools and context</span>
  </div>
</div>

<p class="install-query-more">Read the <a href="https://docs.escribano.work" target="_blank" rel="noopener">full documentation</a> for more recipes and the complete CLI reference.</p>

</section>

<section class="install-unlock">

<h2 class="install-unlock-title">Unlock full history <span class="install-unlock-tag">Optional</span></h2>

<p>The free tier lets you query <strong>your last 7 days</strong> of captured work. A beta key removes that limit so you can ask about anything you've ever recorded.</p>

<h3 class="install-unlock-sub">How to get a key</h3>

<p>Just ask. Either:</p>

<div class="install-request-paths">
  <div class="install-request-card">
    <div class="install-request-icon" aria-hidden="true">✉</div>
    <div>
      <div class="install-request-label">Email</div>
      <a href="mailto:info@escribano.work">info@escribano.work</a>
    </div>
  </div>
  <div class="install-request-card">
    <div class="install-request-icon" aria-hidden="true">💬</div>
    <div>
      <div class="install-request-label">From the app</div>
      <span>Use the <strong>Send support request</strong> option</span>
    </div>
  </div>
</div>

<p>Tell me briefly what you want to use it for — or if budget is tight, just say so, that's fine. I'm handing keys out while we stabilise so we can talk to early users and shape the roadmap with them.</p>

<h3 class="install-unlock-sub">Activating</h3>

<p>Once you receive a key, open <strong>Terminal</strong> and run:</p>

```
escribano-query activate ESC-BETA-XXXX
```

<p>Replace <code>ESC-BETA-XXXX</code> with the key you received.</p>

<p class="install-questions">Questions? <a href="mailto:info@escribano.work">info@escribano.work</a></p>

</section>
