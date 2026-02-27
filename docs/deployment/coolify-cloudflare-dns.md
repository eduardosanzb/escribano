# Coolify + Cloudflare DNS-01 SSL Setup

How to deploy services on a Coolify server behind Cloudflare's proxy with automatic SSL certificates.

## The Problem

Traefik (Coolify's reverse proxy) uses **HTTP-01 challenge** by default to get SSL certificates from Let's Encrypt. This works by Let's Encrypt making an HTTP request to:

```
http://yourdomain.com/.well-known/acme-challenge/<token>
```

When Cloudflare's **orange-cloud proxy** is enabled, it intercepts that request before it reaches your server — the challenge never arrives, and certificate issuance fails indefinitely:

```
ERR Cannot retrieve the ACME challenge for yourdomain.com (token "...")
```

The fix is **DNS-01 challenge**: instead of serving a token over HTTP, Traefik creates a temporary TXT DNS record via the Cloudflare API. Let's Encrypt validates that record directly — no HTTP involved, proxy doesn't matter.

---

## Architecture

```
Browser → Cloudflare (proxy, orange cloud) → your server (46.224.72.233)
                                                    ↓
                                               Traefik (Coolify proxy)
                                                    ↓
                                          your app containers
```

Both `raus.cloud` and `escribano.work` point to the same server IP via Cloudflare proxy. Traefik routes by `Host` header.

---

## Step 1 — Create Cloudflare API Token

1. Go to [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click **Create Token** → use **"Edit zone DNS"** template
3. Set **Zone Resources** to `Include` → **All zones** (not specific zones — avoids `zone could not be found` errors)
4. Click **Continue to summary** → **Create Token**
5. Copy the token — shown only once

**Verify the token before using it:**

```bash
curl -X GET "https://api.cloudflare.com/client/v4/zones" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" | python3 -m json.tool | grep '"name"'
```

You should see all your domains listed. If not, the token scope is wrong.

---

## Step 2 — Configure Traefik

### 2a. Pass the API token

Coolify's UI silently drops `environment:` blocks when it saves the proxy config. Use a `.env` file instead — Docker Compose reads it automatically:

```bash
echo "CF_DNS_API_TOKEN=your_real_token_here" > /data/coolify/proxy/.env
```

This file persists even when Coolify rewrites `docker-compose.yml`.

### 2b. Update the proxy compose config

In Coolify UI → **Servers** → your server → **Proxy** → **Configuration**, replace the `httpchallenge` lines with `dnschallenge`:

```yaml
name: coolify-proxy
networks:
  coolify:
    external: true
  # ... your other networks
services:
  traefik:
    container_name: coolify-proxy
    image: 'traefik:v3.6'
    restart: unless-stopped
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    networks:
      - coolify
      # ... your other networks
    ports:
      - '80:80'
      - '443:443'
      - '443:443/udp'
      - '8080:8080'
    healthcheck:
      test: 'wget -qO- http://localhost:80/ping || exit 1'
      interval: 4s
      timeout: 2s
      retries: 5
    volumes:
      - '/var/run/docker.sock:/var/run/docker.sock:ro'
      - '/data/coolify/proxy/:/traefik'
    command:
      - '--ping=true'
      - '--ping.entrypoint=http'
      - '--api.dashboard=true'
      - '--entrypoints.http.address=:80'
      - '--entrypoints.https.address=:443'
      - '--entrypoints.http.http.encodequerysemicolons=true'
      - '--entryPoints.http.http2.maxConcurrentStreams=250'
      - '--entrypoints.https.http.encodequerysemicolons=true'
      - '--entryPoints.https.http2.maxConcurrentStreams=250'
      - '--entrypoints.https.http3'
      - '--providers.file.directory=/traefik/dynamic/'
      - '--providers.file.watch=true'
      - '--certificatesresolvers.letsencrypt.acme.dnschallenge=true'
      - '--certificatesresolvers.letsencrypt.acme.dnschallenge.provider=cloudflare'
      - '--certificatesresolvers.letsencrypt.acme.dnschallenge.resolvers=1.1.1.1:53,8.8.8.8:53'
      - '--certificatesresolvers.letsencrypt.acme.dnschallenge.delaybeforecheck=30'
      - '--certificatesresolvers.letsencrypt.acme.storage=/traefik/acme.json'
      - '--api.insecure=false'
      - '--providers.docker=true'
      - '--providers.docker.exposedbydefault=false'
    labels:
      - traefik.enable=true
      - traefik.http.routers.traefik.entrypoints=http
      - traefik.http.routers.traefik.service=api@internal
      - traefik.http.services.traefik.loadbalancer.server.port=8080
      - coolify.managed=true
      - coolify.proxy=true
```

Key changes from default:
- Removed: `httpchallenge=true` and `httpchallenge.entrypoint=http`
- Added: `dnschallenge=true`, `provider=cloudflare`, `resolvers`, `delaybeforecheck=30`

### 2c. Delete stale acme.json and restart

```bash
rm /data/coolify/proxy/acme.json
docker compose -f /data/coolify/proxy/docker-compose.yml up -d --force-recreate
```

Then watch logs:

```bash
docker logs coolify-proxy -f
```

You should see certificates issuing within 1-3 minutes per domain.

---

## Step 3 — Cloudflare SSL Mode

In Cloudflare dashboard for each domain:

- **SSL/TLS** → **Overview** → set to **Full (strict)**

This tells Cloudflare to verify your origin's SSL certificate. With `Full (strict)` and DNS-01 working, end-to-end SSL is fully valid.

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `zone could not be found` | Token lacks zone access | Recreate token with "All zones" scope |
| `403 unauthorized` / `Incorrect TXT record` | DNS propagation race condition | Ensure `delaybeforecheck=30` is set |
| `missing token` | Env var not passed to container | Use `.env` file at `/data/coolify/proxy/.env` |
| `no valid A records found` | DNS not configured | Add A record in Cloudflare pointing to server IP |
| 502 Bad Gateway | Traefik routing to wrong port | Check container port (see below) |
| No logs after restart | Coolify dropped config changes | Verify changes persisted in compose file on server |

### 502 Bad Gateway — Container Port Mismatch

Coolify defaults all new apps to port **3000**. Static nginx containers listen on port **80**. This causes Traefik to proxy to the wrong port.

Verify what port Traefik is using:

```bash
docker inspect <container_name> | python3 -m json.tool | grep loadbalancer.server.port
```

Fix in Coolify UI: app **Configuration** → **Port** → change from `3000` to `80`. Redeploy.

### Verify a cert was issued

```bash
cat /data/coolify/proxy/acme.json | python3 -m json.tool | grep '"main"'
```

Each issued cert shows up as `"main": "yourdomain.com"`.

---

## Adding a New Domain

1. Add DNS A record in Cloudflare pointing to server IP (orange cloud = proxy enabled is fine)
2. Create new app in Coolify, set the domain
3. **Set the correct port** (80 for nginx, 3000 for Node.js, etc.)
4. Deploy — Traefik picks up the new domain automatically and requests a cert via DNS-01

---

## GitHub Actions Auto-Deploy

The landing page at `escribano.work` auto-deploys on push via a Coolify webhook.

Workflow: `.github/workflows/landing-deploy.yml` — triggers on any push to `main` that touches `apps/landing/`.

Required GitHub secret: `COOLIFY_ESCRIBANO_WEBHOOK` — get the URL from:
Coolify → app → Configuration → Deploy Webhook.
