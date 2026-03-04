# Escribano Landing Page

Hugo static site for [escribano.work](https://escribano.work).

## Features

- **3-state theme toggle** — Light, Dark, and System modes (respects OS preference by default)
- **Responsive design** — Mobile-first with adaptive layouts
- **Paper texture aesthetic** — Subtle noise overlay with light/dark variants
- **Fast static site** — Hugo + nginx, no client-side JavaScript frameworks
- **Auto-deploy** — GitHub Actions triggers Coolify webhook on push to main

## Development

```bash
# Run dev server
hugo server -D
```

## Build

```bash
hugo --gc --minify
```

Output goes to `public/`.

## Deploy

Deploys automatically via GitHub Actions on every push to `main` that touches `apps/landing/`.

Workflow: `.github/workflows/landing-deploy.yml` — triggers a Coolify webhook to redeploy.

**Required GitHub secret:** `COOLIFY_ESCRIBANO_WEBHOOK`
Get the URL from: Coolify → escribano.work app → Configuration → Deploy Webhook.

### Manual deploy (local Docker)

```bash
docker build -t escribano-landing .
docker run -p 8080:80 escribano-landing
```

### Coolify settings

- **Build context:** `apps/landing/`
- **Dockerfile:** `apps/landing/Dockerfile`
- **Port:** `80` (not 3000 — nginx, not Node.js)
- **Domain:** `escribano.work`

For SSL + Cloudflare proxy setup, see [docs/deployment/coolify-cloudflare-dns.md](../../docs/deployment/coolify-cloudflare-dns.md).

## Structure

- `content/_index.md` — Page metadata
- `layouts/index.html` — Single-page layout (all sections)
- `layouts/_default/baseof.html` — HTML shell with fonts, CSS, OG meta
- `assets/css/style.css` — Custom CSS (no Tailwind)
- `static/` — Static assets (favicon, etc.)

