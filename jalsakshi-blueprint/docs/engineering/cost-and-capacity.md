# Cost and capacity

Prices checked21 September2026 UTC. USD list prices, before taxes/foreign exchange/region-specific overage; no purchase authorized. These are infrastructure scenarios, not startup pricing advice or guaranteed quotes.

## Workload arithmetic

Assume30 workers ×10 tests/day ×30days=9,000 tests/month. At4KiB sample metadata, raw samples occupy~35MiB/month before events/indexes/audit. Budget10× metadata overhead as a planning allowance, not a DB measurement. At300KiB/photo, one photo/test produces~2.57GiB/month; three photos/test~7.72GiB. Original images at multi-megabyte size can multiply that volume; measure actual approved retention/resolution.

At30-day photo retention plus temporary uploads/derivatives, a100GB object tier provides headroom for this assumed pilot, not unlimited capacity. Three months of9,000 tests and several case events remain a modest indexed dataset; performance still needs actual query/load testing.

## Sourced price inputs and scenarios

[AWS Lightsail official pricing](https://aws.amazon.com/lightsail/pricing/) lists Linux public-IPv4 bundles at$12/month for2GB and$24 for4GB. The$30/month managed-database tier lists encryption; the cheaper$15 tier lists no data encryption, so it is not the selected real-data option. A100GB object-storage bundle is$3/month; snapshots list$0.05/GB-month. Mumbai transfer allowances for applicable instance bundles are half the headline allowance.

| Scenario | Fixed/month | Variable/allowance | Meaning |
|---|---:|---|---|
| Local synthetic demo | $0 incremental cloud | Existing hardware/electricity; kits/lab/access not included | No external deployment or reliability claim |
| Live pilot baseline | $24 app host +$30 encrypted DB +$3 objects =$57 | Example40GB snapshot storage ×$0.05 =$2; indicative infrastructure total$59/month | Non-HA baseline; provider/region feature validation required |
| Staging while actively used | Up to another$24 app host plus DB/storage arrangement | Separate encrypted data environment required; do not reuse production credentials | Shut down only through approved operations process |
| Higher availability / larger load | Requote after tests | Additional app instance/load balancer/HA database, logs and backup volume | Not included in$59 and not assumed linear scaling |

Domain, identity provider, monitoring, build service, support labor, extra storage/transfer, taxes and FX are excluded from that$59 illustration. Budget a provisional$70–100/month infrastructure allowance for a modest live pilot, **not a sourced all-inclusive quote**. Provider minimum billing/region availability must be checked at purchase.

No per-image cloud inference fee in the selected local design. There are still device energy, engineering, labeling and quality-assurance costs. Astra/Fable subscriptions are team inputs with unknown prices and limits, not assumed free.

## Dominant uncertain costs

Exact FTK per-test cost; reference standards and lot variation; qualified laboratory measurements; travel/field recruitment; participant compensation if appropriate; training and support. Obtain actual supplier/lab quotes in T01/T38. These can dominate hosting and cannot be estimated credibly without selected parameter/method.

A paper with thousands of images does not imply thousands of independent paid lab tests; conversely taking many photos does not replace independent chemistry. Budget independent reference measurements first.

## Capacity thresholds

Initial device working set:1,000 assigned sources and500 queued records; server benchmark includes100,000 samples and10,000 cases. These are test envelopes, not purchased capacity guarantees.

Revisit deployment if sustained CPU>70%, memory>75%, DB lock/pool wait exceeds request budget, queue age grows under stable load, or backups miss RTO. Optimize query/index and hot-tenant transaction first; scale only with measured cause. Model inference remains distributed on devices, but central storage, evidence verification and supervisor workload still scale.

Compare monthly operating cost and staff minutes against evidence-complete cases, not app downloads. No claims of national cost savings until a pilot provides actual denominators.

