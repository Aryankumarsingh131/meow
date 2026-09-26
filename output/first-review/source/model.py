"""JalSakshi first-review model: impact and commercial scenarios.

Every number printed in the PDF's impact, pricing and revenue pages comes from
this file (build.py imports it). All inputs are labelled:
  OBS  = observed fact from a cited source
  EXT  = external benchmark (different context; used only for orientation)
  TGT  = team target (proposed, not achieved)
  ASM  = illustrative assumption (to be replaced by pilot / buyer evidence)

Run `python model.py` to print the tables and run the self-checks.
"""
from math import ceil

FX = 96  # ASM: INR per USD, rounded from FBIL reference ~95.7 (11 Sep 2026) and spot ~95.96 (25 Sep 2026)

# ---------------------------------------------------------------- pricing (ASM, hypothesis)
TIERS = {
    #            monthly fee, setup fee, variable direct cost / month, onboarding delivery cost
    "ESS":  dict(name="Campus Essentials", monthly=7_500,  setup=30_000, var=600,   onboard=15_000, sources=25,  tests_per_source=12),
    "PLUS": dict(name="Campus Plus",       monthly=18_000, setup=60_000, var=1_500, onboard=30_000, sources=60,  tests_per_source=12),
    "PROG": dict(name="Programme",         monthly=30_000, setup=75_000, var=3_000, onboard=60_000, sources=300, tests_per_source=4),
}
# ODK Cloud Standard, USD 199/month billed yearly (OBS, getodk.org/pricing, 25 Sep 2026)
ODK_STANDARD_INR_MONTH = 199 * FX

# ---------------------------------------------------------------- scenarios (ASM)
# Year 1 = Oct 2026 - Sep 2027. Months 1-6 are build + free validation pilots; paying starts are listed by month.
# Year 3 = Oct 2028 - Sep 2029. S = customers at end of Year 2, E = at end of Year 3 (net of churn).
SCEN = {
    "Conservative": dict(
        y1_starts={"ESS": [9, 12], "PLUS": [], "PROG": []},
        S={"ESS": 5, "PLUS": 1, "PROG": 0}, E={"ESS": 10, "PLUS": 3, "PROG": 1}, churn=0.20,
        infra_y1=12_000, infra_y3=20_000,
        opex_y3=dict(founders=27_00_000, engineers=0, sales_travel=4_00_000, validation=4_00_000, security=3_00_000, admin=3_00_000),
    ),
    "Base": dict(
        y1_starts={"ESS": [7, 9, 11], "PLUS": [10], "PROG": []},
        S={"ESS": 12, "PLUS": 3, "PROG": 1}, E={"ESS": 25, "PLUS": 8, "PROG": 3}, churn=0.15,
        infra_y1=12_000, infra_y3=30_000,
        opex_y3=dict(founders=27_00_000, engineers=10_00_000, sales_travel=8_00_000, validation=6_00_000, security=4_00_000, admin=4_00_000),
    ),
    "Optimistic": dict(
        y1_starts={"ESS": [7, 8, 9, 10, 11], "PLUS": [9], "PROG": [10]},
        S={"ESS": 20, "PLUS": 6, "PROG": 3}, E={"ESS": 50, "PLUS": 15, "PROG": 8}, churn=0.10,
        infra_y1=12_000, infra_y3=50_000,
        opex_y3=dict(founders=27_00_000, engineers=20_00_000, sales_travel=15_00_000, validation=8_00_000, security=5_00_000, admin=6_00_000),
    ),
}
# Year 1 operating expenses, same in every scenario (ASM). Founders unpaid in the headline case.
OPEX_Y1 = dict(tools_legal_company=1_50_000, sales_travel=1_50_000, kit_and_lab_validation=2_00_000, independent_security_review=1_50_000)
FOUNDER_STIPEND_Y1 = 3 * 5_00_000   # ASM: disclosed sensitivity - what paying three founders a modest stipend adds
PILOT_COST = 2 * (15_000 + 20_000)  # ASM: two free pilots x (onboarding + kits/lab tests)
CS_SALARY = 4_80_000                # ASM: one customer-success/field associate per 25 customers, Year 3
CS_PER = 25


def year1(sc):
    rec = setup = var = onboard = 0
    for t, starts in sc["y1_starts"].items():
        p = TIERS[t]
        for m in starts:
            months = 12 - m + 1
            rec += p["monthly"] * months
            var += p["var"] * months
            setup += p["setup"]
            onboard += p["onboard"]
    n_end = {t: len(s) for t, s in sc["y1_starts"].items()}
    mrr_end = sum(TIERS[t]["monthly"] * n for t, n in n_end.items())
    infra = sc["infra_y1"] * 12
    revenue = rec + setup
    direct = infra + var + onboard
    gross = revenue - direct
    opex = sum(OPEX_Y1.values()) + PILOT_COST
    return dict(customers=n_end, n=sum(n_end.values()), sub=rec, setup=setup, revenue=revenue,
                infra=infra, var=var, onboard=onboard, cs=0, direct=direct, gross=gross,
                gm=gross / revenue if revenue else 0, opex=opex, op=gross - opex,
                op_paid_founders=gross - opex - FOUNDER_STIPEND_Y1, mrr_end=mrr_end, arr_end=mrr_end * 12)


def year3(sc):
    S, E, churn = sc["S"], sc["E"], sc["churn"]
    rec = setup = var = onboard = 0
    adds = {}
    for t, p in TIERS.items():
        avg = (S[t] + E[t]) / 2            # linear build-up through the year
        rec += p["monthly"] * 12 * avg
        var += p["var"] * 12 * avg
        adds[t] = E[t] - S[t] + round(churn * S[t])   # gross new customers needed
        setup += p["setup"] * adds[t]
        onboard += p["onboard"] * adds[t]
    n_end = sum(E.values())
    cs = ceil(n_end / CS_PER) * CS_SALARY
    infra = sc["infra_y3"] * 12
    revenue = rec + setup
    direct = infra + var + onboard + cs
    gross = revenue - direct
    opex = sum(sc["opex_y3"].values())
    mrr_end = sum(TIERS[t]["monthly"] * E[t] for t in TIERS)
    # break-even: fixed costs / contribution per average customer (Year-3 mix)
    mix_monthly = mrr_end / n_end
    mix_var = sum(TIERS[t]["var"] * E[t] for t in TIERS) / n_end
    contrib = (mix_monthly - mix_var) * 12 - CS_SALARY / CS_PER
    breakeven = ceil((opex + infra) / contrib)
    return dict(customers=E, start=S, adds=adds, n=n_end, gross_adds=sum(adds.values()), sub=rec, setup=setup,
                revenue=revenue, infra=infra, var=var, onboard=onboard, cs=cs, direct=direct, gross=gross,
                gm=gross / revenue, opex=opex, op=gross - opex, mrr_end=mrr_end, arr_end=mrr_end * 12,
                breakeven=breakeven, contrib=contrib)


# ---------------------------------------------------------------- impact (per year, Year-3 deployment)
FLAG_RATE = 0.05          # ASM: share of screening records needing follow-up. OBS range for orientation:
                          # 1.4-3.0 % FTK contaminated (Karnataka 2021-24), 24 % household taps failing lab
                          # microbiology (JJM FA 2024). 5 % is a planning value, not a prediction.
BASELINE_FOLLOWUP = 0.18  # EXT: Karnataka 2023-24, 559 of 3,078 FTK-contaminated samples retested (CAG 12/2025)
TARGET_FOLLOWUP = {"Conservative": 0.50, "Base": 0.75, "Optimistic": 0.90}  # TGT


def impact(name, sc):
    records = sum(TIERS[t]["sources"] * TIERS[t]["tests_per_source"] * sc["E"][t] for t in TIERS)
    sources = sum(TIERS[t]["sources"] * sc["E"][t] for t in TIERS)
    flagged = records * FLAG_RATE
    base_done = flagged * BASELINE_FOLLOWUP
    tgt_done = flagged * TARGET_FOLLOWUP[name]
    return dict(sources=sources, records=records, flagged=round(flagged), owned=round(flagged),
                base_done=round(base_done), tgt_done=round(tgt_done), extra=round(tgt_done - base_done),
                target=TARGET_FOLLOWUP[name])


# ---------------------------------------------------------------- reachable market (bottom-up, ASM heavy)
COLLEGES = 45_473            # OBS: AISHE 2021-22, colleges registered (MoE, released 25 Jan 2024)
RESIDENTIAL_SHARE = 0.30     # ASM: share with hostels/own storage the operator is answerable for - not sourced
REACHABLE_GEO_SHARE = 0.10   # ASM: share reachable by direct sales in 2-3 states within three years


def market():
    serviceable = round(COLLEGES * RESIDENTIAL_SHARE)
    reachable = round(serviceable * REACHABLE_GEO_SHARE)
    acv = TIERS["ESS"]["monthly"] * 12
    return dict(serviceable=serviceable, reachable=reachable, acv=acv, reachable_value=reachable * acv)


def run():
    return {n: dict(y1=year1(sc), y3=year3(sc), impact=impact(n, sc)) for n, sc in SCEN.items()}


def lakh(x):
    return f"₹{x / 1e5:,.1f} L"


if __name__ == "__main__":
    R = run()
    for n, r in R.items():
        y1, y3, im = r["y1"], r["y3"], r["impact"]
        print(f"\n== {n}")
        print(f" Y1: customers {y1['customers']} rev {lakh(y1['revenue'])} (sub {lakh(y1['sub'])} setup {lakh(y1['setup'])}) "
              f"direct {lakh(y1['direct'])} GM {y1['gm']:.0%} opex {lakh(y1['opex'])} op {lakh(y1['op'])} "
              f"op(paid founders) {lakh(y1['op_paid_founders'])} ARR-end {lakh(y1['arr_end'])}")
        print(f" Y3: customers {y3['customers']} adds {y3['adds']} rev {lakh(y3['revenue'])} (sub {lakh(y3['sub'])} setup {lakh(y3['setup'])}) "
              f"direct {lakh(y3['direct'])} GM {y3['gm']:.0%} opex {lakh(y3['opex'])} op {lakh(y3['op'])} ARR-end {lakh(y3['arr_end'])} "
              f"break-even {y3['breakeven']} customers")
        print(f" Impact: {im}")
    print("\nmarket", market(), "ODK std INR/month", ODK_STANDARD_INR_MONTH)

    # self-checks: the arithmetic the PDF relies on
    b = R["Base"]["y1"]
    assert b["sub"] == 7500 * (6 + 4 + 2) + 18000 * 3            # starts m7, m9, m11 ESS; m10 PLUS
    assert b["arr_end"] == (3 * 7500 + 18000) * 12
    assert b["arr_end"] != b["revenue"]                         # year-end ARR is not Year-1 revenue
    y3 = R["Base"]["y3"]
    assert y3["adds"]["ESS"] == 25 - 12 + 2                    # 15 % of 12 ~ 2 churned
    assert abs(y3["gross"] - (y3["revenue"] - y3["direct"])) < 1
    assert round(559 / 3078, 3) == 0.182                        # CAG Karnataka Table 5.1
    print("self-checks passed")
