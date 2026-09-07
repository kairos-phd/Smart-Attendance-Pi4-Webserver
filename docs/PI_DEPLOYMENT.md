# Raspberry Pi deployment

Use 64-bit Raspberry Pi OS Bookworm or later, fully updated. The InsightFace/ONNX Runtime stack is a candidate until verified on the target Pi.

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y python3-venv python3-pip python3-opencv v4l-utils git
git clone <YOUR_REPOSITORY_URL> smart-attendance
cd smart-attendance/services/edge
cp .env.example .env
```

Edit `.env` for camera paths, Pi ID, Firebase service-account location and image/privacy settings.
You can configure 1, 2, or 3 cameras:
- `CAMERAS_COUNT=1`: Runs with only Camera 1.
- `CAMERAS_COUNT=2`: Runs with Cameras 1 and 2.
- `CAMERAS_COUNT=3`: Runs with Cameras 1, 2, and 3.
- Alternatively, toggle `CAMERA_1_ENABLED=true`, `CAMERA_2_ENABLED=true`, `CAMERA_3_ENABLED=false`.
- If 3 cameras are configured but only 1 or 2 physical cameras are plugged in, the service automatically marks the missing camera(s) `offline` in Firestore and continues running normally for the plugged-in cameras. When a camera is plugged in later, it recovers automatically.

Create the secret directory and copy the service-account JSON with restrictive permissions:

```bash
sudo install -d -m 700 /opt/smart-attendance/secrets
sudo install -m 600 /path/to/firebase-service-account.json /opt/smart-attendance/secrets/firebase-service-account.json
```

Install and test the edge service manually before installing the boot service:

```bash
./scripts/install_edge.sh
.venv/bin/python -m attendance_edge.main
```

With cameras and Firebase validated, install the system service:

```bash
sudo ./scripts/install_systemd.sh
sudo systemctl status smart-attendance-edge
journalctl -u smart-attendance-edge -f
```

The service is configured to restart after a crash. If any camera disconnects, it is marked offline and periodically retried without stopping the active cameras.

