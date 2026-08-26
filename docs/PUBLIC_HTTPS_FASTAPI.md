# Public HTTPS for SIC FastAPI

## Live architecture

```text
https://sic4b.io.vn
  -> Firebase Hosting

https://api.sic4b.io.vn
  -> Cloudflare Tunnel (sic-fastapi)
  -> http://127.0.0.1:8000
  -> laptop FastAPI, InsightFace and local images
```

The fallback dashboard remains `https://sicccc-30fed.web.app`. Router port forwarding is not required.

## Cloudflare resources

- Domain: `sic4b.io.vn`
- API hostname: `api.sic4b.io.vn`
- Tunnel name: `sic-fastapi`
- Local ignored configuration: `F:\SIC\.cloudflared\config.yml`
- Private Cloudflare credentials: `%USERPROFILE%\.cloudflared` (never commit or share)

## Manual startup

Open PowerShell and start FastAPI:

```powershell
cd F:\SIC\services\backend
.\scripts\run_backend.ps1
```

Open a second PowerShell window and start the tunnel:

```powershell
cd F:\SIC\services\backend
.\scripts\run_public_https.ps1
```

Verify:

```powershell
Invoke-RestMethod https://api.sic4b.io.vn/health
```

The result should report `status: ok`, `firebase: ready`, and `ai: ready`.

## Web configuration

`F:\SIC\apps\web\.env.production` contains:

```env
VITE_API_BASE_URL=https://api.sic4b.io.vn
```

The backend `CORS_ORIGINS` must include:

```text
https://sic4b.io.vn
```

Build and deploy from these folders:

```powershell
cd F:\SIC\apps\web
npm run build

cd F:\SIC
npx --yes firebase-tools deploy --only hosting --project sicccc-30fed
```

## Required Firebase console setting

After the custom domain is verified, add `sic4b.io.vn` under **Firebase Authentication > Settings > Authorized domains**. This is required for sign-in on the custom domain.

## Security and availability

- Keep FastAPI bound to `127.0.0.1`.
- Do not open router or Windows firewall port 8000 to the internet.
- Admin endpoints require a Firebase administrator ID token.
- Camera ingestion requires `X-Device-Key`.
- Never commit `.env`, Cloudflare credentials, Firebase service-account keys, datasets, models or unknown-person images.
- The API is offline if the laptop, FastAPI, internet connection or tunnel is offline.
- Automatic Windows services should be configured only after the manual two-camera test passes.
