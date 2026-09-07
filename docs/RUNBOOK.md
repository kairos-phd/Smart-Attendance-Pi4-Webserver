# Run and troubleshooting guide

## Run order

1. Deploy Firebase rules and create an administrator.
2. Install the edge service on the Pi. Verify each camera independently, then together.
3. Start FastAPI where it is reachable by the dashboard:

   ```bash
   cd services/backend
   cp .env.example .env
   ./scripts/install_backend.sh
   .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

   If FastAPI runs on the Pi, install its boot service only after this manual check passes:

   ```bash
   sudo ./scripts/install_systemd.sh
   sudo systemctl status smart-attendance-api
   ```

4. Run the dashboard:

   ```bash
   cd apps/web
   cp .env.example .env
   npm install
   npm run dev
   ```

   For Firebase Hosting, build with production Firebase values in `.env`, then from the repository root run `firebase deploy --only hosting`. Add the resulting HTTPS URL to `CORS_ORIGINS` in `services/backend/.env` and restart the API.

5. Run the mobile companion:

   ```bash
   cd apps/mobile
   cp .env.example .env
   npm install
   npx expo start
   ```

## Acceptance checks

- `v4l2-ctl --list-devices` shows stable camera paths for connected cameras (1, 2, or 3 cameras).
- Edge logs report each available camera online; any disconnected camera is logged as offline and retried asynchronously without affecting active cameras.
- Walking into each camera view creates one event, rather than constant duplicates.
- A registered face produces an attendance record; an unregistered face produces an unknown event.
- Disconnecting Wi-Fi queues events and reconnecting flushes the queue.
- Dashboard at `https://sic4b.io.vn/` displays live camera health (`online/total`), supports camera filtering, and matches Firestore.

## Common problems

| Symptom | Check |
| --- | --- |
| Only 1 or 2 webcams open | Normal when only 1 or 2 are plugged in: edge service keeps running for available cameras. For missing cameras, verify `/dev/v4l/by-id` paths, test with `v4l2-ctl`, and check USB hub power. |
| First AI run is slow/fails | InsightFace downloads its model on first use. Pre-cache it with Internet before the demonstration and confirm `MODEL_ROOT`. |
| No records in Firebase | Check service-account path/permissions, device clock, outbound network and `journalctl` errors. Pending events remain in `data/edge.db`. |
| Duplicate attendance | Increase `ATTENDANCE_COOLDOWN_SECONDS`; do not lower it until real testing shows a need. |
| Recognition is unreliable | Register several well-lit photos, test threshold/angles/lighting, and record measurements before changing `MATCH_THRESHOLD`. |
| Dashboard gets permission denied | Sign out/in to refresh the Firebase admin claim; deploy Firestore rules and verify project IDs. |

## Demo fallback

Pre-register at least two consented test users, warm the models after boot, have a network hotspot/router ready, and keep a recent camera test log. The system runs reliably with 1, 2, or 3 active cameras.
