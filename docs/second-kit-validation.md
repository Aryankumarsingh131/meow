# Second-kit configuration (T40), BLOCKED

Status: **not started.** It needs a second manufacturer's kit, its protocol
and newly collected data. None of these exist, and the first kit is itself
still synthetic (T01).

`ml/protocols/second-kit.json` is deliberately **not** created: a placeholder
protocol would look like a configured kit.

## What the exercise will show once the inputs exist

1. A new protocol file with its own id and version: bins, read window and
   language labels from the manufacturer's instructions.
2. A new model trained and evaluated only on that kit's data (ml/ pipeline,
   T23–T27). The first kit's accuracy is never reused.
3. A new model manifest and SHA-256. The app refuses a model whose protocol
   does not match (`protocol_mismatch`, T26), and the kill switch (T37) can
   disable it independently of the first kit.
4. The domain and analytical acceptance repeated (T27, T46).

## Already in place

The app and server key everything on `protocol.id` and `protocol.version`,
and the model loader checks the manifest against the protocol before loading.
So a second kit is a configuration and validation exercise, not a code change.
Not tested with a real second protocol.
