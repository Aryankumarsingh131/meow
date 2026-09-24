# Offline storage and privacy checks (T32)

Status: **partial.** Temporary-file cleanup is fixed and uploads stay off.
**Encryption at rest is not implemented**: it needs new native dependencies
and a decision (below).

| Acceptance item | State | Evidence |
|---|---|---|
| Default no uploads | **Met** | The app contains no call to `/v1/evidence/*`: photos never leave the phone. Hosted deployments also answer 503 to evidence upload (AC-018 default) |
| Temp cleanup | **Fixed** | Found: every save *copied* the camera's photo, leaving a plaintext original in the cache folder indefinitely, plus leftovers from abandoned or retaken captures. Now the original is deleted **after** the save commits (never before, so a failed save loses nothing), and startup sweeps `<cache>/Camera`. `tests/local-save.test.ts` checks both the deletion and that every failure point keeps the original |
| Database encrypted (SQLCipher) | **Not done** | `expo-sqlite` opens a plain SQLite file |
| Images independently protected | **Not done** | Saved photos are plain files in the app's private documents folder |
| Key loss safe | **Not applicable yet** | No key exists until encryption is added |

## What protects the data today

- Android app sandboxing: the database and photos are in the app's private
  storage, unreadable by other apps on a non-rooted phone.
- The phone's own full-disk encryption, which modern Android enables by
  default, protects a powered-off phone.
- Neither protects against a rooted device, a backup extraction, or anyone
  with the unlocked phone in hand. That gap is what T32 exists to close.

## What encryption needs (decision)

1. `expo-secure-store` (Android Keystore) to hold a random database key.
   The key never leaves the Keystore-wrapped store.
2. `expo-sqlite` with SQLCipher enabled (`useSQLCipher` in its config plugin)
   and `PRAGMA key` on open.
3. Photo encryption: a small native module (`modules/secure-evidence`) doing
   AES-GCM with its own Keystore key, so photos are protected independently of
   the database.
4. Key-loss rule: if the Keystore key is gone (app data cleared, device reset),
   the app must say so plainly and keep any **unsent** records it can still
   read. Nothing is silently discarded.

All three are native changes: a rebuild of the app (about 7 minutes, and the
build machine currently has about 2 GB free). The Keystore key is tied to the
device, so a restored backup on another phone cannot decrypt, which is intended.

## How to re-check

```
node tests/local-save.test.ts        # temp cleanup and failure ordering
grep -rn "evidence/intents" apps/mobile/src   # must find nothing: no uploads
```
On a device: after saving a photo, `adb shell run-as org.jalsakshi.mobile ls cache/Camera`
must be empty.
