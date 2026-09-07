# PC camera capture test

This process emulates the future Raspberry Pi transport while the Sony ILCE-6400 is connected directly to the laptop. It monitors at low FPS, selects a frame after meaningful motion, JPEG-compresses it, and sends it to the laptop FastAPI recognition endpoint.

## Requirements

- FastAPI health at `http://localhost:8000/health` must report `ok`.
- Close Windows Camera, Imaging Edge preview, OBS, and other applications that may lock the camera.
- The ILCE-6400 is currently available to OpenCV as camera index `1`.

## One-frame test

Open PowerShell in `F:\SIC\services\backend`:

```powershell
.\.venv\Scripts\python.exe .\scripts\pc_camera_capture.py --camera-index 1 --once --no-preview
```

## Find the correct camera index

First close the current SIC preview and any other camera application. Then run:

```powershell
.\.venv\Scripts\python.exe .\scripts\pc_camera_capture.py --scan-cameras
```

Choose an index reported as `live/changing`. An index reported as `static/placeholder` is commonly an inactive virtual camera such as OBS Virtual Camera.

## Continuous motion-selected capture

Open PowerShell in `F:\SIC\services\backend`:

```powershell
.\.venv\Scripts\python.exe .\scripts\pc_camera_capture.py --camera-index 1
```

The preview displays the latest result. Press `Q`, `Esc`, or `Ctrl+C` to stop. A graceful stop reports the PC camera and capture device as offline.

Default behavior:

- Monitor at 4 FPS.
- Capture at 640×480.
- Send at most one selected frame every 3 seconds.
- Require a moving region of at least 1,800 pixels.
- Encode JPEG at quality 85.
- Send a device/camera heartbeat every 10 seconds.
- Do not store raw frames or images in Firestore.

## Multi-Camera Testing on PC (1, 2, or 3 Cameras)

You can run multiple instances simultaneously in separate PowerShell windows to simulate 1, 2, or 3 cameras:

### Camera 1:
```powershell
.\.venv\Scripts\python.exe .\scripts\pc_camera_capture.py --camera-index 0 --camera-id camera-1 --camera-name "Entrance camera"
```

### Camera 2:
```powershell
.\.venv\Scripts\python.exe .\scripts\pc_camera_capture.py --camera-index 1 --camera-id camera-2 --camera-name "Desk camera"
```

### Camera 3:
```powershell
.\.venv\Scripts\python.exe .\scripts\pc_camera_capture.py --camera-index 2 --camera-id camera-3 --camera-name "Exit camera"
```

Each instance maintains its own OpenCV preview window, heartbeat, and ingestion feed. The dashboard at `https://sic4b.io.vn/` will show the cameras online in real-time (`1/3`, `2/3`, or `3/3`).

## Useful tuning examples

More sensitive motion selection:

```powershell
.\.venv\Scripts\python.exe .\scripts\pc_camera_capture.py --camera-index 1 --motion-min-area 900
```

Reduce AI requests:

```powershell
.\.venv\Scripts\python.exe .\scripts\pc_camera_capture.py --camera-index 1 --cooldown 8
```

The placeholder `DEVICE_API_KEY` is accepted only with a localhost FastAPI URL. Replace it with a long random secret before the Raspberry Pi or another computer connects over the network.
