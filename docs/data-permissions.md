# Data permissions — feasibility set (T23)

## The current set

`ml/data/syn-color-001.feasibility.v1.json` is entirely synthetic. Every
image was rendered by `ml/feasibility_set.py` from four published fixture
colours. It contains no photograph of a person, place or water source, no
location, no device identifier and no personal data. Every record says so:
`permissions.personal_data: false`, `consent: not_applicable_synthetic`,
`reuse: unrestricted_synthetic`.

It may be copied, shared and used for training, testing and demonstration
without restriction. It must never be presented as real-world or laboratory
evidence.

## Before any real data is collected

Nothing below has been done. It lists what a real collection must record
before a single real image enters the manifest.

| Question | What the record must hold |
|---|---|
| Who owns the water source and the site? | Written permission from the owner or the responsible authority to sample and photograph |
| Who takes the photographs? | The worker's consent to their captures being used for model training, separately from their work duties |
| Can a person appear in a photo? | No. Capture instructions must keep people out of frame. Any image with a person is excluded, not blurred |
| Is location recorded? | Only if the permission covers it. Otherwise record the source id and leave coordinates out |
| Who supplies the reference result? | A data-sharing agreement with the laboratory covering reuse of results for model development |
| How long is it kept? | A retention period agreed with the permissions above (see T47) |
| Can it be reused? | Only for the purposes the consent names. A new purpose needs new consent |

In the manifest, a real record sets `data_mode: research`,
`label_source: reference_method` and `permissions.consent: recorded`, and adds
the consent reference. The schema refuses a real record without recorded
consent.

Sign-off on the real-data permissions belongs to the project owner and the
domain reviewer, and has not been given.
