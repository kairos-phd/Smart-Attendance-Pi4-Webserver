# SIC shared Firestore data model

**Contract:** MVP v1  
**Status:** Finalized for implementation  
**Firebase project:** `sicccc-30fed`  
**Firestore database:** `(default)` in `asia-southeast1`  
**Deployment timezone:** `Asia/Ho_Chi_Minh`

This is the single data contract shared by the laptop AI service, Raspberry Pi transport, web dashboard, and mobile application. Web and mobile clients must not create competing collections for the same concept.

Firestore timestamps represent absolute instants. The denormalized `date` field uses the deployment timezone and the exact `YYYY-MM-DD` format. Document IDs are repeated in event payloads where this helps exports and offline retry validation.

## System ownership

| Component | Responsibility |
| --- | --- |
| Firebase Authentication | Login identity and email/password credentials |
| Web/mobile client | Reads authorized dashboard data; creates only its own account profile |
| Laptop AI/FastAPI service | Creates face profiles, attendance, unknown-person events, and operational records using Firebase Admin SDK |
| Raspberry Pi | Captures camera frames, queues them during outages, and sends them to the laptop; it does not own the cloud schema |
| Firestore | Shared metadata and real-time application state |
| Local laptop storage | Face models, the working dataset, and optional unknown-person images for the MVP |

Administrator authorization is carried by the Firebase Authentication custom claim `admin: true`; an editable Firestore field must never be trusted as authorization.

## Access roles

| Capability | Viewer (default signup) | Administrator (`admin: true`) |
| --- | --- | --- |
| Overview, attendance and device/camera status | Read | Read |
| Unknown-person events/images | No access | Read |
| Face-profile list and enrollment | No access | Manage through FastAPI |
| Accounts | Own profile only | Administrative inspection |
| Attendance/device/event writes | No access | No direct client writes; trusted services only |

Every public signup is a viewer. Administrator access is granted separately with the protected backend script; the signup form must never allow a person to choose the administrator role.

## `accounts/{firebaseUid}`

Dashboard/mobile account profile linked one-to-one with Firebase Authentication.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `username` | string | yes | Display username |
| `username_normalized` | string | yes | Lowercase unique lookup value |
| `date_of_birth` | `YYYY-MM-DD` string | yes | User-provided date of birth |
| `email` | string | yes | Same email as Firebase Authentication |
| `email_verified` | boolean | yes | Profile snapshot; Authentication remains authoritative |
| `requires_email_verification` | boolean | yes | Signup policy marker |
| `created_at` | timestamp | yes | Server creation time |

Relationship: document ID equals the Firebase Authentication UID.

## `usernames/{normalizedUsername}`

Reserves unique usernames without scanning every account.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `uid` | string | yes | Related `accounts`/Authentication UID |
| `created_at` | timestamp | yes | Reservation time |

## `users/{faceProfileId}`

Face-recognition profile managed only by the laptop FastAPI/Admin SDK. This is deliberately separate from `accounts`: a person being recognized by a camera does not need a dashboard login.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | Person's full name |
| `student_id` | string | yes | Human-readable university/employee identifier |
| `face_embedding` | number array | yes | Protected model embedding; never exposed to normal clients |
| `status` | `active` or `inactive` | yes | Whether recognition is allowed |
| `registration_date` | timestamp | yes | Enrollment time |
| `registration_image_path` | string or null | no | Optional Storage object path; null when the source image is kept locally or discarded |
| `deactivated_at` | timestamp | no | Deactivation time |

Relationship: `attendance.user_id` references this document ID, while `student_id` is shown to users.

## `attendance/{eventId}`

One accepted attendance decision. The AI service uses an idempotent event ID to prevent duplicates during retries.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `attendance_id` | string | yes | Same value as the document ID |
| `user_id` | string | yes | Related `users` document ID |
| `name` | string | yes | Name snapshot retained for historical reporting |
| `camera_id` | string | yes | Related `cameras` document ID |
| `timestamp` | timestamp | yes | Recognition time stored as an absolute instant |
| `date` | `YYYY-MM-DD` string | yes | Reporting date calculated in `Asia/Ho_Chi_Minh` |
| `confidence` | number | yes | Similarity score used for the decision |
| `status` | `recognized` | yes | Event result |
| `raspberry_pi_id` | string | yes | Source Pi identifier |
| `created_at` | timestamp | yes | Firestore write time |

Lifecycle: retain for the academic reporting period, then archive or delete according to the institution's privacy policy.

## `unknown_events/{eventId}`

Metadata for a face that did not meet the recognition threshold.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `event_id` | string | yes | Same value as the document ID |
| `camera_id` | string | yes | Related `cameras` document ID |
| `timestamp` | timestamp | yes | Detection time |
| `confidence` | number | yes | Best known-user similarity score |
| `recognition_status` | `unknown` | yes | Event result |
| `image_url` | string or null | no | `gs://` Storage path only when remote image review is enabled |
| `raspberry_pi_id` | string | yes | Source Pi identifier |
| `created_at` | timestamp | yes | Firestore write time |

For the MVP, keep `image_url` null and store authorized images locally on the laptop. Do not place base64 image data in Firestore.

## `cameras/{cameraId}`

Latest state for each configured camera.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `camera_id` | string | yes | Same value as the document ID |
| `name` | string | yes | Human-readable camera name |
| `location` | string | no | Deployment location |
| `raspberry_pi_id` | string | yes | Pi responsible for transport |
| `status` | `online` or `offline` | yes | Most recently reported state |
| `last_seen` | timestamp | yes | Latest heartbeat/frame time |
| `last_error` | string | no | Most recent diagnostic message |
| `software_version` | string | no | Pi transport version |

The dashboard should eventually derive stale/offline status from `last_seen`, rather than trusting `status` indefinitely.

## `devices/{deviceId}`

Latest state for the Raspberry Pi transport and laptop AI service. This is separate from `cameras` so a Pi or AI service failure is not mistaken for an individual camera failure.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `device_id` | string | yes | Same value as the document ID |
| `name` | string | yes | Human-readable device name |
| `device_type` | `raspberry_pi` or `laptop_ai` | yes | Device/service responsibility |
| `status` | `online` or `offline` | yes | Most recently reported state |
| `last_seen` | timestamp | yes | Latest heartbeat time |
| `last_error` | string or null | no | Latest safe diagnostic message |
| `software_version` | string | no | Deployed service version |

For the MVP, use stable IDs such as `pi-classroom-01` and `laptop-ai-01`. `cameras.raspberry_pi_id` references the responsible Raspberry Pi document.

## `system_logs/{logId}`

Optional diagnostic records written by trusted services.

Recommended fields: `level`, `component`, `message`, `device_id`, `timestamp`, and a small structured `context` map. Do not store secrets, images, embeddings, or Firebase tokens.

## Required dashboard queries

| Screen | Query |
| --- | --- |
| Attendance for one day | `attendance` where `date == selectedDate`, ordered by `timestamp desc` |
| Attendance date range | `attendance` bounded by `date`, ordered by `date desc`, then `timestamp desc` |
| Unknown people | `unknown_events` ordered by `timestamp desc` |
| Camera monitoring | `cameras` ordered by `name` |
| Device monitoring | `devices` ordered by `name` |

The only required composite index for the current web/mobile queries is `attendance(date DESC, timestamp DESC)`. Single-day equality queries can use Firestore's automatic indexes.

## Storage and privacy decision

Firebase Storage is **not required for the MVP**. Enrollment source images and unknown-person images may remain on the laptop, while Firestore stores metadata only. If remote image review is enabled later, store only an authorized Storage object reference in Firestore; never store base64 images or local Windows/Linux paths in Firestore.

## Deliberately excluded from MVP v1

- No separate web and mobile collections.
- No raw camera frames or face images inside Firestore.
- No public reads or unauthenticated writes.
- No daily summary collection yet; it can be derived from attendance events at the current scale.
- No check-in/check-out session fields until that workflow is explicitly implemented.

## Data flow

```text
Two cameras
  -> Raspberry Pi capture, sampling, and local queue
  -> laptop frame-ingestion API
  -> laptop face recognition and attendance logic
  -> Firestore Admin SDK
  -> shared Firestore collections
  -> web dashboard and mobile application
```

## Demo data rule

The web application's demo data exists only in browser memory. It must never be written to Firestore and is visibly labeled as demonstration data.
