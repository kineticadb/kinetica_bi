# Deploy (Docker + k3s)

Two small images built from one multi-stage `Dockerfile`:

- `web` — nginx serving the built SPA, proxies `/api` to the server (same origin)
- `server` — the Node/Express API on port 4000

## Build locally

```bash
docker build --target web    -t kinetica-bi-web:dev .
docker build --target server -t kinetica-bi-server:dev .
```

CI (`.github/workflows/build-images.yml`) pushes both to GHCR on every push to `main`.

## Run on k3s

```bash
openssl rand -hex 32   # AUTH_SECRET
openssl rand -hex 32   # SESSION_ENCRYPTION_KEY
```

Edit `deploy/k3s.yaml`: set the two secrets + `KINETICA_PASSWORD`, point `KINETICA_URL` at your instance, and set the host in the Ingress + `CORS_ORIGIN`. Then:

```bash
kubectl apply -f deploy/k3s.yaml
```

## Auth

Runs in `password` mode: users log in with a **native Kinetica username/password**, and every query/WMS call uses those credentials, so Kinetica enforces access per user. The service account (`KINETICA_USERNAME` / `KINETICA_PASSWORD`) only backs the WMS capabilities probe.

The public URL must be HTTPS — the session cookie is `Secure`. TLS terminates at the Ingress; nginx forwards `X-Forwarded-Proto: https`.

## Config

| Var | Example | Notes |
|---|---|---|
| `KINETICA_URL` | `http://kinetica:9191` | required |
| `AUTH_MODE` | `password` | |
| `AUTH_SECRET` | 32+ random bytes | signs the session cookie |
| `SESSION_ENCRYPTION_KEY` | 64 hex chars | encrypts session creds at rest; rotating logs everyone out |
| `DB_PATH` | `/data/kinetica.db` | put on the PVC or dashboards reset on restart |
| `CORS_ORIGIN` | `https://bi.example.com` | the public origin |
| `KINETICA_USERNAME` / `KINETICA_PASSWORD` | service account | WMS capabilities probe |

State is the SQLite file on the PVC (dashboards/widgets/layers); analytics data lives in Kinetica. Single replica — SQLite on a `ReadWriteOnce` volume.
