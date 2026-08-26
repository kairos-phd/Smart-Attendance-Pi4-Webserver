# Architecture

```mermaid
flowchart LR
  C1["Camera 1"] --> E["Raspberry Pi edge service"]
  C2["Camera 2"] --> E
  E --> M["OpenCV motion monitor"]
  M -->|activity| AI["InsightFace: SCRFD + ArcFace"]
  AI --> P["Attendance processor"]
  P -->|online| F["Firebase: Firestore + Storage"]
  P -->|offline| Q["Local SQLite event queue"]
  Q -->|reconnected| F
  F --> W["React dashboard"]
  F --> A["Expo mobile app"]
  W --> B["FastAPI admin gateway"]
  B --> F
```

## Why a small FastAPI gateway is used

Firebase is the selected database/cloud service. The gateway is not a second database or general event broker. It is required only for privileged actions that must not expose a Firebase Admin credential to browsers or phones:

- face enrollment: detect a face and create an embedding;
- user deletion/update;
- admin-only system operations.

It may run on the Pi for a LAN demonstration or a small trusted server. The edge service writes directly to Firebase with its own service account because it must continue to queue and synchronize events independently of a dashboard being open.

## Edge behavior

Each camera has a lightweight OpenCV frame loop. A background-subtraction motion detector triggers one candidate frame after its own cooldown. A process-wide AI lock permits only one recognition job at a time. For each detected face:

1. create a normalized embedding;
2. compare it with cached active-user embeddings by cosine similarity;
3. record a recognized event unless the same person/camera is inside the attendance cooldown;
4. otherwise create an unknown event and optionally retain its image;
5. write online or enqueue in local SQLite when Firebase is unavailable.

The user cache is refreshed periodically. Do not run two copies of the edge process against the same cameras.

## Firestore collections

| Collection | Key fields |
| --- | --- |
| `users` | `name`, `student_id`, `face_embedding`, `registration_date`, `status` |
| `attendance` | `user_id`, `name`, `camera_id`, `timestamp`, `date`, `confidence`, `status` |
| `unknown_events` | `camera_id`, `timestamp`, `image_url`, `confidence`, `recognition_status` |
| `cameras` | `camera_id`, `name`, `location`, `raspberry_pi_id`, `status`, `last_seen` |
| `system_logs` | `device_id`, `timestamp`, `event_type`, `message` |

Firestore server timestamps are used for cloud records. Every edge event also carries a UTC ISO timestamp for reliable offline replay.

## Data protection

- Service-account JSON, API keys and local event databases are excluded from Git.
- The dashboard/mobile apps use Firebase Authentication; Firestore/Storage rules deny unauthenticated access.
- Only administrators can access face embeddings. Regular authenticated clients get attendance, unknown events and device status but not embedding arrays.
- Use HTTPS when FastAPI is not confined to a trusted LAN. Keep the Pi updated and protect SSH with keys.
