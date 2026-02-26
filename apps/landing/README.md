# Escribano Landing Page

Hugo static site for [escribano.work](https://escribano.work).

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

Docker + Coolify:

```bash
docker build -t escribano-landing .
docker run -p 8080:80 escribano-landing
```

In Coolify, set build context to `apps/landing/` and deploy.

## Structure

- `content/_index.md` - Page metadata
- `layouts/index.html` - Single-page layout (all sections)
- `layouts/_default/baseof.html` - HTML shell with fonts, CSS, OG meta
- `assets/css/style.css` - Custom CSS (no Tailwind)
- `static/` - Static assets (favicon, etc.)
