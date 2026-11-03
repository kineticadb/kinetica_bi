# Container

Two images from one multi-stage `Dockerfile`:

- `web` — nginx serving the built SPA, proxies `/api` to the server
- `server` — the Node/Express API (port 4000)

CI publishes both to GHCR. `main` builds are tagged `v<version>-main-<sha>-<ts>`; a `v*` git tag publishes a clean `vX.Y.Z`.

## Build

    docker build --target web    -t kinetica-bi-web .
    docker build --target server -t kinetica-bi-server .

## Run

    docker run -d --name kbi-server -p 8080:8080 \
      -e AUTH_MODE=password \
      -e KINETICA_URL=https://your-kinetica:9191 \
      -e AUTH_SECRET=$(openssl rand -hex 32) \
      -e SESSION_ENCRYPTION_KEY=$(openssl rand -hex 32) \
      kinetica-bi-server
    docker run -d --name kbi-web --network container:kbi-server kinetica-bi-web

Open http://localhost:8080. The two containers share a network namespace (as they do in one k8s pod), so nginx reaches the API on `localhost:4000`.

Login uses native Kinetica credentials (password mode). `SESSION_ENCRYPTION_KEY` is 64 hex chars and required; `AUTH_SECRET` signs the session cookie.

## AI streaming (SSE)

`/api/ai/ask` streams server-sent events (SSE over POST), so `nginx.conf` has an exact-match location for it with response buffering, caching and gzip off. Any other proxy or ingress in front of the web container must also disable response buffering for that path (or pass through the server's `X-Accel-Buffering: no` header), and its idle timeout must exceed 15 s (the server sends a heartbeat every 15 s).
