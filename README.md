# Smart Attendance System

Multi-camera (1, 2, or 3 cameras), event-triggered attendance with a Raspberry Pi 4 (4 GB) transport and a laptop AI service. The Pi performs lightweight capture/motion sampling and sends selected frames to FastAPI on the laptop. The laptop runs face recognition and writes metadata to Firebase Authentication/Firestore. Firebase Storage is optional.

## MVP architecture

```text
USB/Pi Camera 1, 2, 3 (dynamic 1, 2, or 3 active cameras)
        -> Raspberry Pi transport (capture -> motion/sample -> retry queue)
        -> laptop FastAPI (SCRFD + ArcFace -> attendance decision)
        -> Firestore
        -> React dashboard and Expo mobile app

Dashboard registration -> laptop FastAPI -> local dataset + protected face embedding metadata
```

The practical AI choice is InsightFace `buffalo_sc` on the laptop CPU: its SCRFD detector and ArcFace-style embedding model run through ONNX Runtime. Frames are event-triggered and recognition work is serialized with bounded queues so concurrent multi-camera feeds do not overload the service.

## Repository layout

| Path | Purpose |
| --- | --- |
| `services/edge` | Existing Raspberry Pi code; it will be reduced to camera transport, sampling and an offline queue in the Pi integration step |
| `services/backend` | Laptop FastAPI, AI recognition, local dataset, device ingestion and privileged Firebase writer |
| `apps/web` | React/Vite administration dashboard |
| `apps/mobile` | Expo/React Native companion for Android and iOS |
| `firebase` | Firestore, Storage rules and required indexes |
| `docs` | assembly, deployment, architecture, test and troubleshooting instructions |

## Fast path: local development

1. Use Firebase project `sicccc-30fed` with Email/Password Authentication and Firestore. Storage is optional.
2. Follow [Firebase setup](docs/FIREBASE_SETUP.md), deploy the supplied rules, then create an administrator account.
3. Configure and run the laptop backend using [Backend setup](docs/BACKEND_SETUP.md). The dashboard needs `VITE_API_BASE_URL` pointing to it.
4. Configure the Raspberry Pi transport after the laptop API and AI pipeline have been tested locally.
5. Configure the web and mobile `.env` files with Firebase web-app values and run their standard development commands.

Complete commands, deployment and recovery guidance are in [Runbook](docs/RUNBOOK.md). Hardware connection details are in [Hardware assembly](docs/HARDWARE_ASSEMBLY.md).

## Scope notes

- The mobile app is deliberately a read-oriented companion. User enrollment remains dashboard/admin-only because facial enrollment is a privileged action.
- Optional LCD, LED and buzzer have no implementation dependency. PIR remains excluded: OpenCV motion detection is the documented trigger.
- Camera model, inference time, recognition threshold, camera resolution and long-duration stability are **test-required**, not claimed performance results.

Pi video/Recog admin integration and no-PC deployment options: [PI_WEB_INTEGRATION.md](docs/PI_WEB_INTEGRATION.md).
