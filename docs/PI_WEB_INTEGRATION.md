# Pi cameras, Recog and recognition log on sic4b.io.vn

This change adds an admin panel under Administration. Video receives one WebRTC
track per configured camera. Recog controls global Pi recognition across cameras;
the selected-camera control changes Pi display selection only. Video is independent
of Recog. The table shows the latest 100 observations including accepted, unknown
and rejected results, camera IDs, scores, reasons and model versions; refresh is every 10 seconds.
This does not replace enrollment or the existing PC inference/attendance path.

## Current rollout gate

Do not restart a production Pi into the new model path until its embedding
compatibility preflight and target-hardware acceptance benchmark pass. Two legacy
identities currently need a validated embedding migration/re-enrollment. Do not use
an incompatible-embedding override as a production shortcut. The standalone Pi
console watcher can improve the existing console before the full rollout.
No physical cameras, Firebase deployment, target hardware, credentials, TURN or
production API are exercised by local unit tests/builds.

## Configuration and trust boundaries

Backend `services/backend/.env` (server-side only):

```dotenv
PI_API_BASE_URL=https://pi-api.sic4b.io.vn
PI_API_TOKEN=<same-secret-as-Pi-ADMIN_SHARED_TOKEN>
PI_ID=pi-classroom-01
PI_CAMERA_IDS=icspring,jieli,sonix
FIREBASE_DATABASE_URL=https://sic4b-smart-attendance-default-rtdb.asia-southeast1.firebasedatabase.app
```

The bridge accepts only a fixed operator-configured origin; it has no target URL
input. Public HTTP URLs, credentials in URLs, query strings, fragments and upstream
redirects are rejected. Private-network HTTP is allowed for LAN/VPN deployment;
only configure an origin you operate. HTTPS is recommended. Each request first uses
the site's existing Firebase `verify_id_token(check_revoked=True)` and strict admin
claim. If PI_API_TOKEN is omitted, the verified incoming Firebase admin ID token is
forwarded and Pi must verify the same Firebase project. Shared-token mode works even
if Pi and website Firebase auth projects differ, but browser signaling still requires
one matching project. Pi token and service-account JSON must never use VITE_ variables.

Web `apps/web/.env`:

```dotenv
VITE_API_BASE_URL=https://api.sic4b.io.vn
VITE_FIREBASE_DATABASE_URL=https://sic4b-smart-attendance-default-rtdb.asia-southeast1.firebasedatabase.app
```

All other existing VITE_FIREBASE_* auth variables must match the project used by Pi
signaling. The source hosting/auth project is `sicccc-30fed`, while the supplied Pi project is
`sic4b-smart-attendance`. Do not automatically change the public site Firebase
configuration. Decide and validate matching auth, backend service credentials and
RTDB URL before deployment; changing only the RTDB URL is insufficient. A static web publish cannot
start FastAPI or remove its runtime requirement. Missing PI_API_BASE_URL or RTDB
configuration produces an actionable panel message and disables video as appropriate.

Endpoints on the website backend: GET `/api/pi/status`, PATCH `/api/pi/control`,
GET `/api/pi/recognition-events?limit=100` (limit 1–1000). They proxy `/health`,
`/api/control/remote` and `/api/recognition-events` respectively, with bounded
connect/read timeout and sanitized errors. Pi control returns `selected_camera_id`
plus global `recognition_enabled`. The proxy camera allowlist must match real Pi IDs.
POST `/api/pi/webrtc-sessions` verifies the current admin token with revocation checks,
validates a bounded SDP offer and configured camera, then writes a server-generated
session ID and timestamp under the verified UID. DELETE
`/api/pi/webrtc-sessions/{session_id}` accepts a UUID hex ID and removes only that
verified UID’s session. The explicit FIREBASE_DATABASE_URL must match browser/Pi
RTDB; the backend service account must have access to it. Arbitrary database URLs
are not accepted from the browser.

## WebRTC signaling rules and lifecycle

Review `firebase/database.webrtc.rules.template.json`; it is a narrow template,
not linked into firebase.json and not automatically deployed. Merge only its
`webrtc` subtree into the real project's rules so existing nodes remain intact.
Review all root/ancestor `.read` and `.write` grants: an inherited `true` or broader
allowing expression over `webrtc` overrides these child restrictions. RTDB child
`.write:false`/`.read:false` cannot revoke an ancestor grant; remove or scope any
such grant away from `webrtc` before rollout.
Browser reads require owner UID + admin claim + Pi/camera allowlist and a timestamp
within five minutes. **All browser writes are denied**, including offer creation and
deletion. Those operations go through the backend, which verifies token revocation
and current admin claims; a stale cached admin token cannot create a new Pi session.
The backend and Pi use trusted Firebase Admin SDK writes, which bypass rules. Backend
validation therefore enforces offer schema, SDP bounds, server timestamp and configured
Pi/camera identity. If Pi uses a client SDK, adapt to a service identity before rollout;
do not open browser/root writes. Already active reads/streams remain bounded by the
five-minute session lifetime rather than being instantly revoked.

The backend creates `webrtc/{FirebaseUID}/{randomSessionId}` with fields `offer:{type,sdp}`,
`camera_id`, `pi_id`, `created_at` in Unix milliseconds, `state:offer`. Browser waits
for ICE gathering before sending its SDP offer to the authenticated backend; Pi publishes `answer:{type,sdp}`. No audio or
browser camera permission is required. Reads expire after 5 minutes, and browser
closes streams after 4.5 minutes. Missing answers/connections stop after 30 seconds. Pi errors, revoked/closed/deleted
sessions and viewer-capacity rejection immediately close the peer with a safe message.
Toggle Video off/on to reconnect. Unmount, changed
camera/Pi identity and Video off remove listeners, close peers and request authenticated session deletion. If authorization was revoked, deletion
may be denied; Pi’s five-minute expiry removes the active peer.
A network outage/tab crash may leave records until Pi expires them after 5 minutes;
a periodic administrative deletion job may be needed for storage hygiene.
STUN works on many networks but does not guarantee connectivity. Restrictive NAT
may require TURN on both peers; configure and test TURN before claiming remote-video
availability. Streaming all three cameras has real Pi CPU and uplink costs. Tune
resolution/FPS and benchmark all cameras concurrently.

## Remove the PC dependency

Recommended topology: Firebase static site -> HTTPS FastAPI on an always-on Linux
VPS -> HTTPS named Cloudflare Tunnel on Pi; browser video uses Firebase signaling
and direct WebRTC/TURN media. Tunnel alone does not keep a powered-off PC API alive.

On Pi, after installing cloudflared and authenticating an operator-owned Cloudflare
zone, create a **named** tunnel (do not use an ephemeral trycloudflare URL):

```bash
cloudflared tunnel login
cloudflared tunnel create attendance-pi
cloudflared tunnel route dns attendance-pi pi-api.sic4b.io.vn
```

Create `/etc/cloudflared/config.yml` with the returned tunnel UUID and credentials
JSON path, ingress `hostname: pi-api.sic4b.io.vn`, `service: http://127.0.0.1:8080`
(use the actual Pi port), followed by `service: http_status:404`. Example config (replace `TUNNEL_UUID` with the value returned above):

```yaml
tunnel: TUNNEL_UUID
credentials-file: /home/sic4b/.cloudflared/TUNNEL_UUID.json
ingress:
  - hostname: pi-api.sic4b.io.vn
    service: http://127.0.0.1:8080
  - service: http_status:404
```

Install the service:

```bash
sudo cloudflared --config /etc/cloudflared/config.yml service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

Keep the Pi API authenticated even behind the tunnel. If Cloudflare Access protects
it, configure a separate supported service-token mechanism; do not assume a browser
Firebase token will satisfy Access. This bridge currently supports Pi bearer auth.

On the Linux VPS (existing backend keeps enrollment/inference):

```bash
git clone --branch fix/pi-stream-control https://github.com/kairos-phd/Smart-Attendance-Pi4-Webserver.git
cd Smart-Attendance-Pi4-Webserver/services/backend
python3 -m venv .venv
.venv/bin/pip install '.[ai]'
# Copy .env.example to .env; configure Firebase credentials, model/data paths and Pi.
# Validate model assets/dataset under the existing runbook; never copy secrets to web.
cd ../..
sudo bash services/backend/scripts/install_systemd.sh <service-user>
sudo systemctl status smart-attendance-api
```

The installer uses the existing API systemd unit. Point `api.sic4b.io.vn` DNS to the VPS and allow public ports 80/443. One option
is Caddy (`sudo apt install caddy` on a supported Debian/Ubuntu VPS). Add this block
to the existing `/etc/caddy/Caddyfile`, preserving any other sites:

```caddyfile
api.sic4b.io.vn {
    reverse_proxy 127.0.0.1:8000
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Restrict public access to port 8000 with the host/provider firewall; use the HTTPS
proxy as the public API. Configure CORS for https://sic4b.io.vn, and keep service JSON
and .env readable only by the service user. Migration must copy enrollment dataset,
model assets and unknown images with their existing permissions and backups; a
fresh VPS alone does not reproduce existing recognition behavior. Build review:

```bash
cd apps/web
npm ci
npm run build
```

Build output is `apps/web/web-build`. Website and rules publication remain a separate
operator rollout after acceptance checks. Existing Firebase CLI deployment/runbook
should be followed for the actual hosting project; do not deploy the rules template
wholesale. Local verification requires no real Firebase calls.

A VPS removes the PC requirement but costs a recurring rental (provider/CPU/storage
prices vary, commonly a few to tens of USD/month; inference may need more resources).
Firebase RTDB has usage quotas/billing and TURN has bandwidth charges. Cloudflare
Tunnel generally has a free tier but availability depends on your ISP, Cloudflare,
Firebase, Pi power and service health; it is not a guarantee of uninterrupted uptime.
An always-on Linux mini-PC/LAN server can replace a VPS if network reachability is
maintained via tunnel/VPN, with power and maintenance costs instead. Hosting this
backend on Pi competes with camera/recognition workload and needs benchmarking.
Keeping the existing Windows backend uses already supplied scripts
`setup_uptime_24_7.ps1` / `install_windows_autostart.ps1` with tunnel management;
autostart recovers after reboot but PC must stay powered, awake and online.


Local stream lifecycle verification (requires `npm ci`, no Firebase access):

```bash
npm run test:pi-stream --prefix apps/web
```

This compiles the production lifecycle guard in a temporary directory and verifies
terminal states, capacity, the connection deadline and timer cancellation with fake
timers. It does not assert physical media or real-network connectivity.
