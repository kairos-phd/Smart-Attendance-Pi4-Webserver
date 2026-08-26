# SIC laptop FastAPI setup

The laptop is the AI and privileged Firebase service. The Raspberry Pi will only send sampled camera frames and heartbeats to it.

## 1. Install Python

This workspace already contains a prepared `.venv`. If it is removed later, install 64-bit Python 3.11 and ensure the Windows `py` launcher is available before recreating it.

## 2. Install the backend

Open PowerShell in `F:\SIC\services\backend` and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install_backend.ps1
```

This installs the FastAPI/Firebase foundation locally in `.venv`.

Install the laptop AI dependencies with:

```powershell
.\scripts\install_backend.ps1 -WithAI
```

The project uses InsightFace 1.0.1 or newer, whose default installation no longer builds the optional legacy `face3d` C++ extension. The `buffalo_sc` model may be downloaded the first time the fully configured backend starts. Use the official package and model source only.

## 3. Obtain Firebase Admin credentials

In Firebase Console, open project `sicccc-30fed`:

1. Project settings
2. Service accounts
3. Generate new private key
4. Save it outside source control, for example `F:\SIC\secrets\firebase-service-account.json`

Never upload or commit this JSON file.

## 4. Configure the backend

Inside `F:\SIC\services\backend`:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set the correct `FIREBASE_SERVICE_ACCOUNT` path. Keep `FIREBASE_STORAGE_BUCKET` blank for the current local-image design. Replace `DEVICE_API_KEY` with a long random secret.

## 5. Grant your dashboard account administrator access

Inside `F:\SIC\services\backend`:

```powershell
.\.venv\Scripts\python.exe .\scripts\set_admin.py your-email@example.com
```

Then sign out of the dashboard and sign in again so Firebase refreshes the ID token.

Newly registered accounts are viewers by default. Do not add an administrator checkbox to signup. To revoke administrator access later, run:

```powershell
.\.venv\Scripts\python.exe .\scripts\set_admin.py your-email@example.com --remove
```

## 6. Run the backend

Inside `F:\SIC\services\backend`:

```powershell
.\scripts\run_backend.ps1
```

Keep this terminal open. Verify [http://localhost:8000/health](http://localhost:8000/health). A fully configured service returns `status: ok`. Missing Firebase or AI configuration returns `status: degraded` with a specific error instead of refusing the connection.

The expected response for the current laptop setup is:

```json
{
  "status": "ok",
  "service": "online",
  "firebase": "ready",
  "ai": "ready",
  "storage": "disabled",
  "errors": []
}
```

`storage: disabled` is correct because enrollment samples and unknown-person crops are stored privately on the laptop.

## 7. Connect the local dashboard

Open `F:\SIC\apps\web\.env` and confirm:

```env
VITE_API_BASE_URL=http://localhost:8000
```

Open another PowerShell window in `F:\SIC\apps\web` and run:

```powershell
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), sign in as an administrator, disable Demo Mode, and wait up to 15 seconds for the FastAPI check. The Users and Administration controls will then be enabled.

If the page still reports FastAPI offline:

1. Open [http://localhost:8000/health](http://localhost:8000/health) directly.
2. Confirm that only one process is using port 8000 with `netstat -ano | findstr :8000`.
3. Confirm `VITE_API_BASE_URL=http://localhost:8000` in `apps\web\.env`.
4. Restart `npm run dev` after changing an environment file.
5. Sign out and back in if the administrator role was just granted.

## 8. Understand the public Firebase website limitation

`https://sicccc-30fed.web.app` cannot use `http://localhost:8000` as a shared backend. On a phone, `localhost` means the phone itself, and an HTTPS page is not allowed to call an insecure HTTP API.

For remote enrollment and account administration, first provide a stable HTTPS address for the laptop FastAPI service. Then set that address in `F:\SIC\apps\web\.env.production`:

```env
VITE_API_BASE_URL=https://your-secure-api-address.example
```

Rebuild and redeploy the dashboard after changing this value. Do not expose port 8000 directly through router port forwarding. Use an authenticated HTTPS tunnel or a separately hosted control API. Camera/AI processing can remain on the laptop.

## Current endpoints

| Endpoint | Authentication | Purpose |
| --- | --- | --- |
| `GET /health` | Public | Laptop API, Firebase, AI and Storage readiness |
| `GET /api/users` | Firebase administrator token | List enrolled people |
| `POST /api/users` | Firebase administrator token | Enroll one person from 3–8 face samples and create the local dataset entry |
| `PATCH /api/users/{id}` | Firebase administrator token | Update enrollment metadata/status |
| `DELETE /api/users/{id}` | Firebase administrator token | Deactivate recognition without deleting history |
| `POST /api/devices/heartbeat` | `X-Device-Key` | Update Pi and camera state |
| `POST /api/ingest/frame` | `X-Device-Key` | Recognize a sampled frame and write attendance/unknown metadata |

The device endpoints are for the later Raspberry Pi step. They are ready but cannot be tested end-to-end until cameras and the Pi transport are configured.
