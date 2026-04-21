---
title: "Get Started"
date: 2026-04-09
draft: false
description: "Download and set up Escribano in four steps"
layout: "single"
---

[**Download for macOS →**](https://github.com/eduardosanzb/escribano-releases/releases/latest)

*Apple Silicon (M1+) · 16 GB RAM minimum · macOS 13 or later*

---

## 1. Install

Open the downloaded `.dmg` and drag **Escribano** to your Applications folder. On first launch, first try right-click the app icon → **Open**. If macOS still blocks launch or shows no prompt, go to **System Settings → Privacy & Security**, scroll down to Escribano's security warning, click **Open Anyway**, then confirm **Open**. This extra step is required because the app is not yet signed with an Apple Developer ID.

## 2. Grant Screen Recording

When prompted, click **Open System Settings** and enable Escribano under **Privacy & Security → Screen Recording**. The app will stay alive and wait — it will not capture anything until this permission is granted.

## 3. Start working

Escribano will begin capturing your screen in the background. A small icon appears in your menu bar showing recording status. All processing runs locally — nothing leaves your machine.

---

## 4. Activate your beta key

If you received a beta invitation, open **Terminal** and run:

```
escribano-query activate ESC-BETA-XXXX
```

Replace `ESC-BETA-XXXX` with the key you received. This unlocks unlimited history — the free tier shows only the last 7 days.

Questions? [info@escribano.work](mailto:info@escribano.work)
