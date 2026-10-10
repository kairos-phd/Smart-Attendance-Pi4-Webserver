# Use the existing Pi data across the website

The media gateway and Check-in page can work while the old AI API on port 8000 is stopped. Previously, the other pages still used that API and Firestore collections. `VITE_DATA_SOURCE=pi` switches their data and user management to the same Pi. Existing Firebase login accounts remain separate from registered face identities.

The gateway authenticates website administrators before accessing the Pi with its existing server-only shared token. The read-only `/api/dashboard` route projects existing SQLite users, grouped attendance and unknown observations, without exporting embeddings or changing models. It paginates each history independently and filters dates in Asia/Ho_Chi_Minh. Accepted recognition attempts suppressed by cooldown are not additional attendance records. Unknown observations have no retained photo; no candidate's guessed identity is exported. Administrators can keep an observation as unknown or dismiss it. These decisions are stored separately in `dashboard_reviews.sqlite3` beside the existing Pi database, preserving the original observations and recognition behavior. Old Firestore fixtures are excluded in Pi mode but remain stored.

## 1. Update the Pi route only

Run in the existing Pi shell. Do not pull the entire inference implementation into this installation: its current model fingerprint and registered embeddings must remain intact.

```bash
(
  set -e
  cd /home/sic4b/Smart-Attendance-Pi4-multiple-cams
  git fetch origin main
  git show FETCH_HEAD:src/pi4_attendance/dashboard_feed.py > /tmp/sic-dashboard-feed.py
  git show FETCH_HEAD:scripts/update_dashboard_only.py > /tmp/sic-dashboard-update.py
  python3 /tmp/sic-dashboard-update.py --repo "$PWD" --source /tmp/sic-dashboard-feed.py
  python3 /tmp/sic-dashboard-update.py --repo "$PWD" --source /tmp/sic-dashboard-feed.py --apply
  sudo systemctl restart sic-pi4-attendance
  for attempt in $(seq 1 30); do
    if curl --fail --silent http://127.0.0.1:8080/health; then break; fi
    sleep 2
  done
  systemctl is-active sic-pi4-attendance
)
```

This changes only `api.py` and `dashboard_feed.py`. The updater prints its backup directory under `/home/sic4b/sic-dashboard-backups`; existing inference, models, identities and attendance database are retained. A running recognition session pauses during the service restart. The endpoint requires the existing admin token; an anonymous 401 demonstrates protection, not a connection failure.

## 2. Build a fresh PC release with existing configuration

Keep the SSH forwarding and Cloudflare Tunnel terminals open. Stop only the old gateway terminal with Ctrl+C. Run these commands in PC PowerShell. They fetch source without modifying the locked `F:\SICWEB` working tree and copy the actual running release's configuration, including its server-side token. No credential is printed or committed.

```powershell
Set-Location F:\SICWEB
git fetch --refmap= origin main
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed' }
$script = Join-Path $env:TEMP 'sic-update-dashboard.ps1'
$source = git show FETCH_HEAD:scripts/update_pc_dashboard.ps1
if ($LASTEXITCODE -ne 0) { throw 'Script missing' }
[IO.File]::WriteAllLines($script, $source, [Text.UTF8Encoding]::new($false))
powershell -NoProfile -ExecutionPolicy Bypass -File $script -RunGateway
```

The gateway stays in that terminal on port 8081. In another PC PowerShell terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8081/health
Invoke-RestMethod https://sic4b.io.vn/health
```

No DNS change or Firebase Hosting deploy is needed. Reload the website with Ctrl+F5 and sign in as an administrator. Confirm the real camera IDs, existing face identities, today's saved attendance and CSV. Test a new enrollment only if needed: it runs on the Pi's current model. Account administration uses Firebase Auth through the lightweight gateway without starting the PC inference API. Pi data pages require an admin account in this mode.

If a build/install fails, the previous release and pointer remain available. If the new gateway fails after installation, stop it, restore the printed previous release path to `%LOCALAPPDATA%\SIC-media-current.txt`, and launch its gateway with its `.env.media` as before. The tunnel and SSH target are unchanged.

## Limits

This is a shared live data source, not a copy of Pi history into Firestore. The PC, gateway, tunnel, SSH forwarding and Pi must remain on for live data. Existing local Pi records remain saved when the network is lost. Unknown images remain unavailable because the Pi feed contains observations only; reviewing an observation does not register a person or change recognition thresholds. Physical Pi/browser deployment must be verified after running the commands; automated tests do not measure on-device performance or recognition accuracy. See [AUTO_UPDATE_AND_PORTABILITY.md](AUTO_UPDATE_AND_PORTABILITY.md) for CI and moving to another network or PC.
