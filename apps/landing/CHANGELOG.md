# Changelog

All notable changes to the Escribano landing page will be documented in this file.

## [Unreleased]

## 2026-03-01

### Added
- **3-state theme toggle** — Light/Dark/System options (System is default for new visitors)
- **Mobile theme dropdown** — Compact menu for theme selection on small screens
- **GitHub icon** — Replaced text with SVG icon in navigation

### Changed
- **Hide mobile CTA** — "Try it free" button hidden on mobile for cleaner nav
- **Paper texture opacity** — Increased from 0.6 to 1.8 in light mode for better visibility
- **Theme persistence** — System preference now stored in localStorage

### Fixed
- **Theme toggle conflicts** — Removed `@media (prefers-color-scheme)` rules that conflicted with JavaScript-controlled theming

## 2026-02-27

### Added
- **Blog section** — `/blog/` with VLM-first pipeline article
- **Dark mode** — Initial dark theme support

## 2026-02-26

### Added
- **Initial release** — Single-page landing site with Hugo
- **Deployment** — Auto-deploy via GitHub Actions + Coolify webhook
- **SSL** — Cloudflare DNS-01 challenge setup
