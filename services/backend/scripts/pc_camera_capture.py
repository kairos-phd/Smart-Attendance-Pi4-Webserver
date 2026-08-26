from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import cv2
import numpy as np
import requests
from dotenv import load_dotenv


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Select frames from a PC webcam and send them to SIC FastAPI")
    result.add_argument("--camera-index", type=int, default=1)
    result.add_argument("--camera-id", default="camera-1")
    result.add_argument("--camera-name", default="Sony ILCE-6400")
    result.add_argument("--device-id", default="pc-capture-01")
    result.add_argument("--api-url", default="http://127.0.0.1:8000")
    result.add_argument("--width", type=int, default=640)
    result.add_argument("--height", type=int, default=480)
    result.add_argument("--monitor-fps", type=float, default=4.0)
    result.add_argument("--cooldown", type=float, default=3.0, help="Minimum seconds between selected frames")
    result.add_argument("--confirmation-frames", type=int, default=3, help="Frames sent after motion for reliable confirmation")
    result.add_argument("--confirmation-interval", type=float, default=0.5)
    result.add_argument("--motion-min-area", type=int, default=1800)
    result.add_argument("--jpeg-quality", type=int, default=85)
    result.add_argument("--heartbeat-seconds", type=float, default=10.0)
    result.add_argument("--request-timeout", type=float, default=20.0)
    result.add_argument("--once", action="store_true", help="Send one frame immediately, then exit")
    result.add_argument("--no-preview", action="store_true")
    result.add_argument("--scan-cameras", action="store_true", help="Check camera indices without starting capture")
    result.add_argument("--scan-max-index", type=int, default=8)
    return result


class MotionSelector:
    def __init__(self, minimum_area: int) -> None:
        self.minimum_area = minimum_area
        self.background: np.ndarray | None = None

    def detected(self, frame: np.ndarray) -> bool:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (21, 21), 0)
        if self.background is None:
            self.background = gray.astype("float")
            return False
        difference = cv2.absdiff(gray, cv2.convertScaleAbs(self.background))
        cv2.accumulateWeighted(gray, self.background, 0.04)
        threshold = cv2.threshold(difference, 25, 255, cv2.THRESH_BINARY)[1]
        threshold = cv2.dilate(threshold, None, iterations=2)
        contours, _ = cv2.findContours(threshold, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        return any(cv2.contourArea(contour) >= self.minimum_area for contour in contours)


def open_camera(index: int, width: int, height: int) -> cv2.VideoCapture:
    capture = cv2.VideoCapture(index, cv2.CAP_DSHOW) if sys.platform == "win32" else cv2.VideoCapture(index)
    if not capture.isOpened() and sys.platform == "win32":
        capture.release()
        capture = cv2.VideoCapture(index)
    if not capture.isOpened():
        raise RuntimeError(f"Camera index {index} could not be opened")
    capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return capture


def scan_cameras(max_index: int) -> None:
    print("Close OBS preview, Windows Camera, and the SIC capture window before scanning.")
    found = False
    for index in range(max_index + 1):
        capture = cv2.VideoCapture(index, cv2.CAP_DSHOW) if sys.platform == "win32" else cv2.VideoCapture(index)
        if not capture.isOpened():
            capture.release()
            continue
        first = None
        last = None
        successful = 0
        for _ in range(12):
            ok, frame = capture.read()
            if ok and frame is not None:
                gray = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (160, 90))
                first = gray if first is None else first
                last = gray
                successful += 1
            time.sleep(0.04)
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        capture.release()
        if successful:
            variation = float(np.mean(cv2.absdiff(first, last))) if first is not None and last is not None else 0.0
            feed = "live/ changing" if variation >= 0.20 else "static/placeholder"
            print(f"index {index}: {width}x{height}, {feed}, variation={variation:.2f}")
            found = True
    if not found:
        print("No available camera could be opened. Another application may be using it.")


def require_device_key(api_url: str) -> str:
    value = os.getenv("DEVICE_API_KEY", "").strip()
    if not value:
        raise RuntimeError("DEVICE_API_KEY is missing from services/backend/.env")
    hostname = urlparse(api_url).hostname
    if value == "replace-with-a-long-random-secret" and hostname not in {"127.0.0.1", "localhost"}:
        raise RuntimeError("Replace the placeholder DEVICE_API_KEY before sending frames over a network")
    if value == "replace-with-a-long-random-secret":
        print("WARNING: placeholder DEVICE_API_KEY is allowed only for this localhost test")
    return value


def health(session: requests.Session, api_url: str, timeout: float) -> None:
    response = session.get(f"{api_url}/health", timeout=min(timeout, 5.0))
    response.raise_for_status()
    body = response.json()
    if body.get("status") != "ok":
        raise RuntimeError(f"FastAPI is not ready: {body}")


def heartbeat(
    session: requests.Session,
    api_url: str,
    headers: dict[str, str],
    args: argparse.Namespace,
    timeout: float,
    status: str = "online",
) -> None:
    response = session.post(
        f"{api_url}/api/devices/heartbeat",
        headers=headers,
        json={
            "device_id": args.device_id,
            "name": "PC camera capture",
            "device_type": "laptop_ai",
            "status": status,
            "software_version": "0.1.0",
            "cameras": [{"camera_id": args.camera_id, "name": args.camera_name, "status": status}],
        },
        timeout=timeout,
    )
    response.raise_for_status()


def send_frame(
    session: requests.Session,
    api_url: str,
    headers: dict[str, str],
    frame: np.ndarray,
    args: argparse.Namespace,
) -> dict:
    encoded, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, args.jpeg_quality])
    if not encoded:
        raise RuntimeError("OpenCV could not encode the selected frame")
    captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    response = session.post(
        f"{api_url}/api/ingest/frame",
        headers=headers,
        files={"frame": ("frame.jpg", jpeg.tobytes(), "image/jpeg")},
        data={
            "camera_id": args.camera_id,
            "camera_name": args.camera_name,
            "raspberry_pi_id": args.device_id,
            "device_type": "laptop_ai",
            "captured_at": captured_at,
        },
        timeout=args.request_timeout,
    )
    response.raise_for_status()
    return response.json()


def result_summary(body: dict) -> str:
    results = body.get("results", [])
    if not results:
        return "no face detected"
    recognized = [item for item in results if item.get("result") == "recognized"]
    unknown = len(results) - len(recognized)
    names = ", ".join(str(item.get("name")) for item in recognized if item.get("name"))
    pieces = []
    if recognized:
        pending = [item for item in recognized if item.get("confirmation_count", 0) < item.get("confirmations_required", 1)]
        if pending:
            item = pending[0]
            pieces.append(
                f"confirming {item.get('name') or 'face'} "
                f"{item.get('confirmation_count', 0)}/{item.get('confirmations_required', 1)}"
            )
        else:
            pieces.append(f"recognized {names or len(recognized)}")
    if unknown:
        item = next(item for item in results if item.get("result") != "recognized")
        count = item.get("confirmation_count", 0)
        required = item.get("confirmations_required", 1)
        pieces.append(f"unknown {unknown}" if count >= required else f"checking unknown {count}/{required}")
    return "; ".join(pieces)


def main() -> None:
    args = parser().parse_args()
    backend_root = Path(__file__).resolve().parents[1]
    load_dotenv(backend_root / ".env")
    if args.scan_cameras:
        scan_cameras(args.scan_max_index)
        return
    args.api_url = args.api_url.rstrip("/")
    key = require_device_key(args.api_url)
    headers = {"X-Device-Key": key}
    session = requests.Session()
    health(session, args.api_url, args.request_timeout)
    capture = open_camera(args.camera_index, args.width, args.height)
    selector = MotionSelector(args.motion_min_area)
    frame_interval = 1.0 / max(args.monitor_fps, 0.5)
    last_send = 0.0
    last_confirmation_send = 0.0
    confirmation_frames_remaining = 0
    last_heartbeat = 0.0
    status_text = "waiting for motion"
    static_reference: np.ndarray | None = None
    static_since = time.monotonic()
    static_warning_shown = False
    print(f"Camera {args.camera_index} connected; sending selected frames to {args.api_url}")
    print("Press Q in the preview window or Ctrl+C in this terminal to stop")

    try:
        while True:
            loop_started = time.monotonic()
            ok, frame = capture.read()
            if not ok or frame is None:
                raise RuntimeError("The camera stopped returning frames")
            now = time.monotonic()
            sample = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (160, 90))
            if static_reference is None:
                static_reference = sample
            elif float(np.mean(cv2.absdiff(static_reference, sample))) >= 0.20:
                static_reference = sample
                static_since = now
                static_warning_shown = False
            elif now - static_since >= 4.0:
                status_text = "Static feed - start OBS output or change camera index"
                if not static_warning_shown:
                    print(status_text)
                    static_warning_shown = True
            if now - last_heartbeat >= args.heartbeat_seconds:
                try:
                    heartbeat(session, args.api_url, headers, args, args.request_timeout)
                    last_heartbeat = now
                except requests.RequestException as exc:
                    status_text = f"heartbeat failed: {exc}"

            motion_detected = selector.detected(frame)
            if motion_detected and now - last_send >= args.cooldown:
                confirmation_frames_remaining = max(1, args.confirmation_frames)
                last_send = now
            selected = args.once or (
                confirmation_frames_remaining > 0
                and now - last_confirmation_send >= max(0.1, args.confirmation_interval)
            )
            if selected:
                try:
                    body = send_frame(session, args.api_url, headers, frame, args)
                    status_text = result_summary(body)
                    last_confirmation_send = now
                    confirmation_frames_remaining = max(0, confirmation_frames_remaining - 1)
                    print(f"{datetime.now():%H:%M:%S} | {status_text}")
                except requests.RequestException as exc:
                    status_text = f"send failed: {exc}"
                    print(status_text)
                if args.once:
                    break

            if not args.no_preview:
                preview = frame.copy()
                cv2.putText(preview, status_text, (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (90, 230, 170), 2)
                cv2.imshow("SIC PC Camera Capture", preview)
                if cv2.waitKey(1) & 0xFF in {ord("q"), 27}:
                    break
            remaining = frame_interval - (time.monotonic() - loop_started)
            if remaining > 0:
                time.sleep(remaining)
    except KeyboardInterrupt:
        print("Capture stopped")
    finally:
        capture.release()
        cv2.destroyAllWindows()
        try:
            heartbeat(session, args.api_url, headers, args, min(args.request_timeout, 5.0), status="offline")
        except requests.RequestException:
            pass
        session.close()


if __name__ == "__main__":
    main()
