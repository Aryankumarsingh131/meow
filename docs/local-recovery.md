# Local save and recovery

T12 stores captures in the app-private document directory and metadata in `jalsakshi.db`. A save has three ordered boundaries:

1. Copy the source to `<asset UUID>.tmp`, read it back, and calculate its SHA-256 and byte count.
2. Move it to `<asset UUID>.asset` in the same managed directory.
3. Insert the sample, asset reference, and pending outbox event in one exclusive SQLite transaction.

The app returns `status: saved` only after step 3 resolves. SQLite uses WAL mode with `synchronous = FULL`. The stored outbox hash is calculated over the exact stored JSON, so retry uses the same bytes and idempotency key.

## Restart rules

`openLocalStorage()` runs recovery before accepting work:

| Last completed boundary | State after restart | Recovery action |
|---|---|---|
| None | No local row | Nothing |
| Temporary copy | Unreferenced `.tmp` | Delete the owned temp file |
| Rename | Unreferenced `.asset` | Delete the owned final file |
| SQLite commit | Referenced `.asset` plus one sample/outbox | Keep it and make the receipt queryable |

Cleanup accepts only UUID-named `.tmp` and `.asset` files. It never removes an unknown filename or a database-referenced asset. A missing referenced asset is reported in `recovery.missing`; its sample and outbox rows stay intact for diagnosis rather than being silently discarded.

If commit succeeds but its acknowledgement is lost, the caller sees an error, never a false success. On restart, the committed receipt is available, and retrying the same sample/event/asset IDs returns that receipt without adding rows.

## Platform boundary

The current Expo FileSystem API provides awaited copy/move and completed byte reads, but no public `fsync` operation. This implementation therefore verifies the copied bytes before the same-directory move and relies on the native operation completing. Encryption at rest is intentionally left for T32; T12 uses the private persistent document directory and does not claim that private storage is encryption.

References: [Expo FileSystem `File` API](https://github.com/expo/expo/blob/main/packages/expo-file-system/src/File.ts), [persistent document path](https://github.com/expo/expo/blob/main/packages/expo-file-system/src/Paths.ts), and [exclusive SQLite transaction behavior](https://github.com/expo/expo/blob/main/packages/expo-sqlite/src/SQLiteDatabase.ts).
