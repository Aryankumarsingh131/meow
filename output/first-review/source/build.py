"""Build the JalSakshi first-review document.

    python build.py            -> writes jalsakshi-first-review.html (next to this file)
    node render.mjs            -> prints the PDF and page PNGs

All financial/impact numbers come from model.py; all citations from REFS below.
"""
from pathlib import Path
import html
import model as M

HERE = Path(__file__).parent
R = M.run()
MK = M.market()


def L(x, d=1):
    """Indian lakh formatting for money."""
    s = f"{abs(x) / 1e5:,.{d}f}"
    return ("−₹" if x < 0 else "₹") + s + " L"


def n(x):
    return f"{x:,.0f}"


# --------------------------------------------------------------------------- references
REFS = [
    # id, short, publisher, title, date, period, url
    ("PIB-FTK", "Ministry of Jal Shakti via PIB", "Field Testing Kits under JJM for Community Water Monitoring (Rajya Sabha reply)", "16 Mar 2026", "JJM-WQMIS data as on 12 Mar 2026", "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2240597"),
    ("CAG-KA", "Comptroller and Auditor General of India", "Performance Audit on Implementation of Jal Jeevan Mission, Government of Karnataka, Report No. 12 of 2025 (Ch. V, Table 5.1, paras 5.1.5, 5.3)", "2026 (tabled)", "2019-20 to 2023-24", "https://cag.gov.in/webroot/uploads/download_audit_report/2025/Combined-Pdf_JJM-Final-03.03.26-069c25b7fcf4287.01649139.pdf"),
    ("CAG-KL", "Comptroller and Auditor General of India", "Jal Jeevan Mission, Government of Kerala, Report No. 10 of 2025, Chapter V: Water Quality Monitoring and Surveillance", "Tabled 24 Feb 2026", "JJM implementation to 2024; replies to June 2025", "https://cag.gov.in/uploads/download_audit_report/2025/10.Chapter-V-0699d7da6b8b144.60620697.pdf"),
    ("FA-2024", "Dept. of Drinking Water & Sanitation, Ministry of Jal Shakti", "Functionality Assessment of Household Tap Connection: National Report 2024 (National Factsheet)", "Dec 2025 (file date)", "Fieldwork Jul-Oct 2024; 19,401 villages, 2,32,691 households", "https://jaljeevanmission.gov.in/sites/default/files/2025-12/FHTC_National%20Report%202024.pdf"),
    ("PIB-LABS", "Ministry of Jal Shakti via PIB", "Water Testing Facilities and Services in the Country (Rajya Sabha reply)", "9 Feb 2026", "JJM-WQMIS as on 4 Feb 2026", "https://pib.gov.in/PressReleasePage.aspx?PRID=2225391"),
    ("DC-INDORE", "Deccan Chronicle", "Judicial Panel Links 24 Indore Water Deaths To Sewage Contamination", "c. 1 Sep 2026", "Deaths 26 Dec 2025 - 25 Feb 2026", "https://www.deccanchronicle.com/nation/judicial-panel-links-24-indore-water-deaths-to-sewage-contamination-1983479"),
    ("AIR-INDORE", "All India Radio News", "Madhya Pradesh HC sets up commission of inquiry to investigate water contamination issue in Bhagirathpura", "28 Jan 2026", "", "https://www.newsonair.gov.in/madhya-pradesh-hc-sets-up-commission-of-inquiry-to-investigate-water-contamination-issue-in-bhagirathpura/"),
    ("PROBE-INDORE", "The Probe", "Indore Water Tragedy Shows How Authorities Failed Citizens", "Jan 2026", "Complaints from 25 Dec 2025", "https://theprobe.in/top-stories/indore-water-tragedy-shows-how-authorities-failed-citizens-2107198"),
    ("DTE-INDORE", "Down To Earth", "Contaminated drinking water case: CAG report found serious flaws, but Indore remained unconcerned", "Jan 2026", "Cites 2019 CAG report (2013-18)", "https://www.downtoearth.org.in/water/contaminated-drinking-water-case-cag-report-found-serious-flaws-but-indore-remained-unconcerned"),
    ("OM-DLF1", "Onmanorama", "Water contamination in Kochi flats: Residents allege attempt to bury test results", "19 Jun 2024", "Lab report dated 29 May 2024", "https://www.onmanorama.com/news/kerala/2024/06/19/kochi-dlf-apartments-water-contamination-residents-slam-association-members.html"),
    ("OM-DLF2", "Onmanorama", "Diarrhoea outbreak at DLF flat: Health dept identifies 441 cases", "19 Jun 2024", "Two weeks to 18 Jun 2024", "https://www.onmanorama.com/news/kerala/2024/06/19/kakkanad-dlf-flat-water-contamination-health-dept-confirms-441-diarrhoea-cases.html"),
    ("DH-CTA", "Deccan Herald", "Water supplied to Kavadigarahatti in Chitradurga not potable, says lab report", "3 Aug 2023", "Samples of 1 Aug 2023", "https://www.deccanherald.com/india/karnataka/karnataka-water-supplied-to-kavadigarahatti-in-chitradurga-not-potable-says-lab-report-1243530.html"),
    ("TNM-CTA", "The News Minute", "Five deaths put Karnataka Dalit village on edge, residents demand probe", "Aug 2023", "", "https://www.thenewsminute.com/article/five-deaths-put-karnataka-dalit-village-edge-residents-demand-probe-181155"),
    ("MD-GMC", "Medical Dialogues (citing Deccan Chronicle)", "Over 30 Gandhi Medical College Hyderabad students fall ill after water contamination", "16 Apr 2026", "", "https://medicaldialogues.in/news/education/medical-colleges/over-30-gandhi-medical-college-hyderabad-students-fall-ill-after-water-contamination-1-contracts-hepatitis-report-168759"),
    ("MWATER", "mWater", "Workflows technical guide; FAQs (\"free, unlimited use\" platform; fees for services); test-kit pricing", "Accessed 25 Sep 2026", "Living documentation", "https://www.mwater.co/workflows"),
    ("ODK", "ODK / Get ODK Inc.", "Introduction to Entities (docs); ODK Cloud pricing", "Accessed 25 Sep 2026", "Living documentation", "https://docs.getodk.org/entities-intro/"),
    ("AKVO", "Akvo Foundation", "akvo-caddisfly: Android app integrated with Akvo Flow (GitHub, GPL-3.0)", "Accessed 25 Sep 2026", "", "https://github.com/akvo/akvo-caddisfly"),
    ("WQMIS", "Dept. of Drinking Water & Sanitation", "JJM-WQMIS Mobile App page (geotagged sample registration; FTK demonstrations)", "Accessed 25 Sep 2026", "", "https://ejalshakti.gov.in/WQMIS/main/mobile_app"),
    ("AISHE", "Ministry of Education via PIB", "All India Survey on Higher Education 2021-22 released", "25 Jan 2024", "Academic year 2021-22", "https://www.pib.gov.in/PressReleasePage.aspx?PRID=1999713"),
    ("PRICES", "Supabase; AWS (via team cost register); ODK", "Supabase pricing (Pro USD 25/mo); AWS Lightsail bundles (checked 21 Sep 2026 in repo cost register); ODK Cloud Standard USD 199/mo", "Accessed 21-25 Sep 2026", "", "https://supabase.com/pricing"),
    ("FX", "FBIL series via CEIC", "USD/INR reference rate 95.725 (11 Sep 2026)", "Accessed 25 Sep 2026", "", "https://www.ceicdata.com/en/india/foreign-exchange-rate-reserve-bank-of-india/foreign-exchange-rate-rbi-reference-rate-us-dollars"),
    ("P15", "Zhang et al., J. Food Measurement & Characterization 20", "A fully on-device and lighting-robust system for nitrite quantification using smartphone colorimetry and ML", "31 Mar 2026", "Prior art (abstract-level read)", "https://link.springer.com/article/10.1007/s11694-026-04299-6"),
    ("P07", "McCarty et al., Environ. Monitoring & Assessment 197:555", "Accessible water quality monitoring through hybrid human-machine colorimetric methods", "15 Apr 2025", "Prior art (methods read)", "https://d-nb.info/1371204373/34"),
    ("HTF", "Tulas ACM Student Chapter", "Hack the Future 3.0 | Project to Product (judging: innovation, technical execution, feasibility, impact, presentation)", "Accessed 25 Sep 2026", "", "https://www.tulashackathon.com/"),
    ("REPO", "JalSakshi team repository", "docs/agent-workflow/current-state.md, docs/final-review.md, docs/demo-evidence.md, ml/model-card.md, docs/scale-decision.md, docs/evidence/screenshots", "25 Sep 2026", "Commit eefc3e0 + uncommitted v2 layer", "(internal)"),
]
IDX = {r[0]: i + 1 for i, r in enumerate(REFS)}


def c(*keys):
    return '<sup class="cite">[' + ",".join(str(IDX[k]) for k in keys) + "]</sup>"


def refs_html():
    out = ['<ol class="refs">']
    for rid, pub, title, date, period, url in REFS:
        link = f'<a href="{html.escape(url)}">{html.escape(url)}</a>' if url.startswith("http") else url
        per = f" Data period: {html.escape(period)}." if period else ""
        out.append(f"<li><b>{html.escape(pub)}</b>. {html.escape(title)}. {html.escape(date)}.{per}<br>{link}</li>")
    out.append("</ol>")
    return "\n".join(out)


# --------------------------------------------------------------------------- research ledger
LEDGER = [
    # claim, ref, numerator/denominator & units, geography/pop, limitation, used on
    ("93.84 lakh FTK tests in 2024-25; 47.59 lakh in 2025-26 (to 12 Mar 2026); 24.80 lakh women trained (cumulative)", "PIB-FTK", "Water samples tested with FTKs; women trained, cumulative", "India, rural (JJM)", "State-reported to WQMIS; 2025-26 is a partial year, not a decline", "Exec, p6"),
    ("FTK results are indicative screening; adverse results need lab confirmation and corrective measures", "PIB-FTK", "Policy statement", "India (JJM)", "Describes the rule, not compliance with it", "p3, p8"),
    ("Karnataka: 0 of 4,540 (2021-22), 0 of 7,909 (2022-23) and 559 of 3,078 (2023-24) FTK-contaminated samples retested (18%)", "CAG-KA", "Retested / contaminated FTK samples", "Karnataka, state totals", "State-level; one state; 7-district sample shows 549 of 910 (60%) retested in 2023-24 - different denominator", "Exec, p4"),
    ("Karnataka: lab turnaround 9-75 days (all 79 labs), 71-106 days (4 private empanelled) vs 24 h chemical / 48 h bacteriological norm", "CAG-KA", "Days, sample receipt to report", "Karnataka labs", "Ranges, not medians", "p4"),
    ("Karnataka: remedial action not taken for 52% of contaminated samples (IMIS)", "CAG-KA", "Share of contaminated samples", "Karnataka", "Period of IMIS chart not stated in text", "p3"),
    ("Karnataka: audit's own tests met the standard in only 2 of 28 test-checked villages", "CAG-KA", "Villages", "28 villages in 7 districts", "Small purposive sample", "p4"),
    ("Kerala: district labs did not communicate results to District/Gram Panchayats for remedial action; WQMIS formats WQ1-6 lacked sampling date, report date, location and remedial action taken", "CAG-KL", "Qualitative audit finding", "Kerala, test-checked districts", "Government disputes; says data uploaded to WQMIS", "Exec, p3, p4"),
    ("Kerala: average district-lab turnaround 45 / 40 / 33 days (Kozhikode / Kollam / Palakkad)", "CAG-KL", "Days", "3 test-checked districts", "Government claims testing within norm; no records furnished", "p4"),
    ("76.0% of household tap samples passed microbiological tests; 72.8% at public institutions; 92.4% of households satisfied with quality; FTKs in 27.2% of villages; VWSC in 55.2%", "FA-2024", "Weighted % of samples / households / villages", "19,401 Har Ghar Jal villages, 761 districts", "Monsoon fieldwork (Jul-Oct 2024); only HGJ villages; third-party NABL lab", "Exec, p6"),
    ("2,870 water-quality testing labs (as on 4 Feb 2026); Citizen Corner shows village-level results", "PIB-LABS", "Labs", "India", "Count, not capacity or turnaround", "p6, p7"),
    ("Indore Bhagirathpura: 36 deaths reported 26 Dec 2025 - 25 Feb 2026; judicial commission reportedly linked 24 to sewage-contaminated municipal supply; six officials held responsible", "DC-INDORE", "Deaths", "Bhagirathpura, Indore", "Commission report confidential; findings reported via lawyers", "p5"),
    ("Indore: complaints to municipal helpline reportedly unattended for days from 25 Dec 2025", "PROBE-INDORE", "Qualitative", "Bhagirathpura", "Residents' accounts; not an official finding", "p5"),
    ("Kochi DLF: 441 residents ill in two weeks (health dept); lab report dated 29 May showed E. coli; residents allege it was not shared until 13 Jun", "OM-DLF1", "People ill", "One apartment complex, Kakkanad", "Disclosure delay is an allegation", "p5"),
    ("Chitradurga Kavadigarahatti: 4 of 5 water samples unfit; Vibrio cholerae found; tank served 220 houses; 5-6 deaths reported", "DH-CTA", "Samples; deaths", "One village", "Death toll varied by report; cause of contamination disputed", "p5"),
    ("Gandhi Medical College hostel: 30+ of ~300 UG students ill; students say they had raised the tank issue earlier", "MD-GMC", "Students ill", "One campus", "Student account; lab results not reported in source", "p5"),
    ("mWater Workflows support assignment, steps, automations and overdue alerts; platform free to end users; fees for services", "MWATER", "Product capability", "Global", "Documentation read; no hands-on trial", "p7"),
    ("ODK Entities support longitudinal case management; offline entity updates need Collect/Central 2024.3+; ODK Cloud Standard USD 199/mo", "ODK", "Product capability, price", "Global", "Documentation read; no hands-on trial", "p7, p16"),
    ("45,473 colleges registered (AISHE 2021-22)", "AISHE", "Colleges", "India", "Not all residential; residential share is an assumption", "p15"),
]


def ledger_table():
    rows = "".join(
        f"<tr><td>{html.escape(a)}</td><td>[{IDX[r]}]</td><td>{html.escape(u)}</td><td>{html.escape(g)}</td><td>{html.escape(lim)}</td><td>{html.escape(p)}</td></tr>"
        for a, r, u, g, lim, p in LEDGER)
    return ('<table class="t small fm"><thead><tr><th style="width:34%">Claim</th><th>Ref</th><th>Unit / denominator</th>'
            '<th>Geography</th><th style="width:22%">Limitation</th><th>Used</th></tr></thead><tbody>' + rows + "</tbody></table>")


def ledger_md():
    lines = ["# JalSakshi first review: source and assumptions ledger", "",
             "Prepared 25 Sep 2026. Publication date and data period are listed separately. "
             "Competitive research scope: desk review of official product pages and docs, 21-25 Sep 2026; no hands-on trials. "
             "A feature not found in documentation is recorded as *not verified*, never as absent.", "",
             "## A. Research ledger", "",
             "| # | Claim / statistic | Source | Publisher | Published | Data period | Unit / denominator | Geography | Limitations | Used in PDF |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for i, (a, r, u, g, lim, p) in enumerate(LEDGER, 1):
        ref = REFS[IDX[r] - 1]
        lines.append(f"| {i} | {a} | [{ref[2]}]({ref[5]}) | {ref[1]} | {ref[3]} | {ref[4] or '-'} | {u} | {g} | {lim} | {p} |")
    lines += ["", "## B. Model assumptions (model.py)", "",
              "Labels: **OBS** observed fact, **EXT** external benchmark from a different context, **TGT** team target, **ASM** illustrative assumption.", "",
              "| Input | Value | Label | Rationale / evidence |", "|---|---|---|---|"]
    for row in ASSUMPTIONS:
        lines.append("| " + " | ".join(row) + " |")
    lines += ["", "## C. Computed results", ""]
    for name, r in R.items():
        y1, y3, im = r["y1"], r["y3"], r["impact"]
        lines.append(f"**{name}**: Year 1 revenue {L(y1['revenue'])} (subscription {L(y1['sub'])}, setup {L(y1['setup'])}); "
                     f"Year 1 operating result {L(y1['op'])} with founders unpaid, {L(y1['op_paid_founders'])} with stipends; "
                     f"ARR at end of Year 1 {L(y1['arr_end'])}. Year 3 revenue {L(y3['revenue'])}, gross margin {y3['gm']:.0%}, "
                     f"operating result {L(y3['op'])}, ARR at end of Year 3 {L(y3['arr_end'])}, break-even ≈ {y3['breakeven']} customers. "
                     f"Impact (Year-3 deployment, per year): {n(im['records'])} screening records, {n(im['flagged'])} flagged, "
                     f"{n(im['base_done'])} followed up at the 18% external benchmark vs {n(im['tgt_done'])} at the {im['target']:.0%} target.")
        lines.append("")
    lines += ["## D. Full references", ""]
    for i, (rid, pub, title, date, period, url) in enumerate(REFS, 1):
        lines.append(f"{i}. {pub}. *{title}*. {date}. {('Data period: ' + period + '. ') if period else ''}{url}")
    return "\n".join(lines) + "\n"


T = M.TIERS
ASSUMPTIONS = [
    ("USD→INR", "₹96", "ASM", "FBIL reference 95.725 (11 Sep 2026), spot ~95.96 (25 Sep 2026), rounded"),
    ("Campus Essentials price", f"₹{T['ESS']['monthly']:,}/month, billed yearly", "ASM", f"Hypothesis; ~{T['ESS']['monthly'] / M.ODK_STANDARD_INR_MONTH:.0%} of ODK Cloud Standard (USD 199 ≈ ₹{M.ODK_STANDARD_INR_MONTH:,}/month); mWater platform is free, so price must be justified by enforced workflow + service"),
    ("Campus Plus price", f"₹{T['PLUS']['monthly']:,}/month", "ASM", "Hypothesis; larger campuses, lab-partner accounts, priority support"),
    ("Programme price", f"₹{T['PROG']['monthly']:,}/month", "ASM", "Hypothesis; NGO / implementation-partner cluster up to ~300 sources"),
    ("Setup fees", f"₹{T['ESS']['setup']:,} / ₹{T['PLUS']['setup']:,} / ₹{T['PROG']['setup']:,}", "ASM", "Source registration, QR tags, training day(s)"),
    ("Onboarding delivery cost", f"₹{T['ESS']['onboard']:,} / ₹{T['PLUS']['onboard']:,} / ₹{T['PROG']['onboard']:,} per new customer", "ASM", "Staff days + travel + tags"),
    ("Variable hosting/storage per customer", f"₹{T['ESS']['var']:,} / ₹{T['PLUS']['var']:,} / ₹{T['PROG']['var']:,} per month", "ASM", "Photos, backups, egress; SMS excluded (not built; would be pass-through)"),
    ("Shared platform infrastructure", "₹12,000/month Y1; ₹20k / 30k / 50k Y3", "ASM", "Repo cost register: USD 59/month pilot baseline, USD 70-100 provisional allowance; Supabase Pro USD 25; doubled for staging + backups"),
    ("Year 1 opex (all scenarios)", L(sum(M.OPEX_Y1.values()) + M.PILOT_COST), "ASM", "Tools/legal/company ₹1.5 L, sales travel ₹1.5 L, kit + lab validation ₹2.0 L, independent security review ₹1.5 L, two free pilots ₹0.7 L"),
    ("Founder pay, Year 1", "₹0 (headline); ₹15 L sensitivity", "ASM", "Disclosed: unpaid founders flatter Year 1"),
    ("Founder pay, Year 3", "₹9 L each × 3", "ASM", "Sustainable staffing assumed from Year 3"),
    ("Customer success staffing", "₹4.8 L per 25 customers", "ASM", "Counted as direct delivery cost"),
    ("Annual churn", "20% / 15% / 10%", "ASM", "No renewal data exists"),
    ("Flag rate (records needing follow-up)", "5%", "ASM", "Orientation: 1.4-3.0% FTK-contaminated (Karnataka 2021-24, CAG) and 24% of household taps failing lab microbiology (FA 2024)"),
    ("Baseline follow-through", "18%", "EXT", "Karnataka 2023-24: 559 of 3,078 FTK-contaminated samples retested (CAG). Different context; our baseline must be measured in the pilot"),
    ("Follow-through target", "50% / 75% / 90%", "TGT", "Share of flagged results with verified lab result + retest within 30 days"),
    ("Sources and test frequency", "25 / 60 / 300 sources; monthly / monthly / quarterly", "ASM", "Per tier; to be replaced by pilot data"),
    ("Residential share of colleges", "30%", "ASM", "Not sourced; used only for the reachable-market illustration"),
    ("Reachable geography share", "10%", "ASM", "Direct sales in 2-3 states within three years"),
]


def assumptions_table():
    rows = "".join(f"<tr><td>{a}</td><td>{b}</td><td><span class='lab {c_.lower()}'>{c_}</span></td><td>{d}</td></tr>" for a, b, c_, d in ASSUMPTIONS)
    return "<table class='t small fm'><thead><tr><th>Input</th><th>Value</th><th>Label</th><th>Rationale / evidence</th></tr></thead><tbody>" + rows + "</tbody></table>"


# --------------------------------------------------------------------------- charts (static SVG for print)
INK, MUTED, GRID, BAR, BAR_LIGHT = "#0F2942", "#5A7387", "#E3EAF1", "#1D5FB0", "#6FA8E8"


def chart_retest():
    data = [("2021-22", 0, 4540), ("2022-23", 0, 7909), ("2023-24", 559, 3078)]
    W, H, x0, bw = 470, 190, 70, 320
    out = [f'<svg viewBox="0 0 {W} {H}" class="chart" role="img" aria-label="Share of FTK-contaminated samples retested in Karnataka by year">']
    for p in (0, 25, 50, 75, 100):
        x = x0 + bw * p / 100
        out.append(f'<line x1="{x}" y1="18" x2="{x}" y2="{H - 34}" stroke="{GRID}" stroke-width="1"/>'
                   f'<text x="{x}" y="{H - 20}" font-size="10" fill="{MUTED}" text-anchor="middle">{p}%</text>')
    out.append(f'<line x1="{x0 + bw}" y1="12" x2="{x0 + bw}" y2="{H - 34}" stroke="{INK}" stroke-width="1.5" stroke-dasharray="4 3"/>'
               f'<text x="{x0 + bw}" y="10" font-size="10" fill="{INK}" text-anchor="end">Guideline: retest all</text>')
    for i, (yr, num, den) in enumerate(data):
        y = 28 + i * 44
        pct = num / den * 100
        w = bw * pct / 100
        out.append(f'<text x="{x0 - 8}" y="{y + 14}" font-size="11" fill="{INK}" text-anchor="end">{yr}</text>')
        if w > 0:
            out.append(f'<rect x="{x0}" y="{y}" width="{w}" height="20" rx="4" fill="{BAR}"/>')
        else:
            out.append(f'<rect x="{x0}" y="{y}" width="2" height="20" fill="{BAR}"/>')
        out.append(f'<text x="{x0 + max(w, 2) + 6}" y="{y + 14}" font-size="11" fill="{INK}"><tspan font-weight="700">{pct:.0f}%</tspan>'
                   f'<tspan fill="{MUTED}">  {num:,} of {den:,} retested</tspan></text>')
    out.append(f'<text x="4" y="{H - 4}" font-size="9.5" fill="{MUTED}">Share of FTK-contaminated samples retested; Karnataka state totals. Source: CAG Report 12 of 2025, Table 5.1.</text></svg>')
    return "".join(out)


def chart_tat():
    rows = [("Karnataka, all 79 labs", 9, 75, "9–75 days"), ("Karnataka, 4 private empanelled labs", 71, 106, "71–106 days"),
            ("Kerala, Palakkad district labs (avg)", 33, 33, "33 days"), ("Kerala, Kollam (avg)", 40, 40, "40 days"),
            ("Kerala, Kozhikode (avg)", 45, 45, "45 days")]
    W, H, x0, bw, mx = 470, 214, 188, 250, 110
    X = lambda d: x0 + bw * d / mx
    out = [f'<svg viewBox="0 0 {W} {H}" class="chart" role="img" aria-label="Laboratory turnaround time compared with the 1 to 2 day norm">']
    out.append(f'<rect x="{X(1)}" y="16" width="{X(2) - X(1) + 2}" height="{H - 64}" fill="#0E9F6E" opacity="0.25"/>'
               f'<text x="{X(2) + 4}" y="12" font-size="10" fill="{INK}">Norm: 1–2 days</text>')
    for d in (0, 25, 50, 75, 100):
        out.append(f'<line x1="{X(d)}" y1="16" x2="{X(d)}" y2="{H - 48}" stroke="{GRID}"/><text x="{X(d)}" y="{H - 35}" font-size="10" fill="{MUTED}" text-anchor="middle">{d}</text>')
    for i, (lab, a, b, txt) in enumerate(rows):
        y = 26 + i * 29
        out.append(f'<text x="{x0 - 8}" y="{y + 11}" font-size="10.5" fill="{INK}" text-anchor="end">{lab}</text>')
        if a == b:
            out.append(f'<circle cx="{X(a)}" cy="{y + 7}" r="5" fill="{BAR}" stroke="#fff" stroke-width="2"/>')
        else:
            out.append(f'<rect x="{X(a)}" y="{y + 2}" width="{X(b) - X(a)}" height="10" rx="4" fill="{BAR}"/>')
        out.append(f'<text x="{X(b) + 8}" y="{y + 11}" font-size="10" fill="{INK}">{txt}</text>')
    out.append(f'<text x="{x0 + bw / 2}" y="{H - 22}" font-size="10" fill="{MUTED}" text-anchor="middle">days from sample to report</text>'
               f'<text x="4" y="{H - 5}" font-size="9.5" fill="{MUTED}">Bars: ranges; dots: district averages. CAG Karnataka 12/2025 §5.1.5; CAG Kerala 10/2025 §5.4.</text></svg>')
    return "".join(out)


def chart_revenue():
    names = list(R)
    W, H, x0, y0, ph = 470, 220, 44, 188, 150
    mx = 100
    Y = lambda v: y0 - ph * v / mx
    out = [f'<svg viewBox="0 0 {W} {H}" class="chart" role="img" aria-label="Recognised revenue, Year 1 and Year 3, by scenario">']
    for v in (0, 25, 50, 75, 100):
        out.append(f'<line x1="{x0}" y1="{Y(v)}" x2="{W - 10}" y2="{Y(v)}" stroke="{GRID}"/><text x="{x0 - 6}" y="{Y(v) + 3}" font-size="10" fill="{MUTED}" text-anchor="end">{v}</text>')
    gw = (W - x0 - 10) / 3
    for i, nm in enumerate(names):
        gx = x0 + i * gw + 22
        for j, (key, col) in enumerate((("y1", BAR_LIGHT), ("y3", BAR))):
            v = R[nm][key]["revenue"] / 1e5
            x = gx + j * 52
            out.append(f'<path d="M{x},{y0} V{Y(v) + 4} q0,-4 4,-4 h36 q4,0 4,4 V{y0} Z" fill="{col}"/>')
            out.append(f'<text x="{x + 22}" y="{Y(v) - 5}" font-size="10.5" fill="{INK}" text-anchor="middle" font-weight="700">{v:.1f}</text>')
        out.append(f'<text x="{gx + 48}" y="{y0 + 16}" font-size="11" fill="{INK}" text-anchor="middle">{nm}</text>')
    out.append(f'<text x="4" y="12" font-size="10" fill="{MUTED}">₹ lakh</text>'
               f'<rect x="{W - 190}" y="4" width="10" height="10" rx="2" fill="{BAR_LIGHT}"/><text x="{W - 176}" y="13" font-size="10" fill="{INK}">Year 1</text>'
               f'<rect x="{W - 120}" y="4" width="10" height="10" rx="2" fill="{BAR}"/><text x="{W - 106}" y="13" font-size="10" fill="{INK}">Year 3</text>'
               f'<text x="4" y="{H - 2}" font-size="9.5" fill="{MUTED}">Recognised revenue (subscription earned in the year + setup fees). Scenarios, not forecasts. Source: model.py.</text></svg>')
    return "".join(out)


def chart_impact():
    im = R["Base"]["impact"]
    rows = [("Flagged results needing follow-up", im["flagged"], BAR, "ASM 5% of screening records"),
            ("Opened as one owned case", im["owned"], BAR, "by design (verified in tests)"),
            ("Followed up at 18% benchmark", im["base_done"], "#9AA8B5", "EXT Karnataka 2023-24"),
            ("Followed up at 75% target", im["tgt_done"], BAR, "TGT, to be proven in pilot")]
    W, H, x0, bw, mx = 470, 172, 190, 200, im["flagged"]
    out = [f'<svg viewBox="0 0 {W} {H}" class="chart" role="img" aria-label="Base scenario follow-through funnel per year">']
    for i, (lab, v, col, note) in enumerate(rows):
        y = 8 + i * 36
        w = bw * v / mx
        out.append(f'<text x="{x0 - 8}" y="{y + 13}" font-size="10.5" fill="{INK}" text-anchor="end">{lab}</text>'
                   f'<rect x="{x0}" y="{y}" width="{w}" height="18" rx="4" fill="{col}"/>'
                   f'<text x="{x0 + w + 6}" y="{y + 13}" font-size="10.5" fill="{INK}" font-weight="700">{v:,}</text>'
                   f'<text x="{x0}" y="{y + 30}" font-size="9" fill="{MUTED}">{note}</text>')
    out.append(f'<text x="4" y="{H - 4}" font-size="9.5" fill="{MUTED}">Base scenario, Year-3 deployment ({n(im["records"])} screening records a year). Illustrative, not measured.</text></svg>')
    return "".join(out)


# --------------------------------------------------------------------------- model tables
def pricing_table():
    rows = [
        ("Validation pilot", "Operator new to JalSakshi", "One site, ≤25 sources, 8–12 weeks shadow use, training, baseline report", "Per pilot", "₹0 (first two); later ₹25,000 credited on conversion", "High (founder-led)", "Converts to Essentials"),
        ("Campus Essentials", "Single campus / hostel group, residential school", "Case workflow, offline field app, lab-report verification, resident complaint intake, exports", "Per site / year", f"₹{T['ESS']['monthly']:,}/mo (₹{T['ESS']['monthly'] * 12 / 1e5:.1f} L/yr) + ₹{T['ESS']['setup']:,} setup", "Email, next business day", "More sources → Plus"),
        ("Campus Plus", "Large or multi-block campus, hospital", "Up to ~100 sources, lab-partner accounts, multiple supervisors, priority support", "Per site / year", f"₹{T['PLUS']['monthly']:,}/mo + ₹{T['PLUS']['setup']:,} setup", "Priority, 4 business hours", "Group / multi-campus"),
        ("Programme", "NGO / implementation partner running village surveillance", "Cluster up to ~300 sources, field-team offline leases, programme dashboards & exports", "Per programme cluster / year", f"₹{T['PROG']['monthly']:,}/mo + ₹{T['PROG']['setup']:,} setup", "Named contact, field refresher", "More clusters / districts"),
    ]
    body = "".join("<tr>" + "".join(f"<td>{x}</td>" for x in r) + "</tr>" for r in rows)
    return ("<table class='t small pt'><thead><tr><th>Tier</th><th>Target customer</th><th>Included value</th><th>Billing unit</th>"
            "<th>Indicative price (excl. GST)</th><th>Support burden</th><th>Expansion path</th></tr></thead><tbody>" + body + "</tbody></table>")


def scenario_table():
    names = list(R)

    def row(label, f, cls=""):
        return f"<tr class='{cls}'><td>{label}</td>" + "".join(f"<td class='num'>{f(R[k])}</td>" for k in names) + "</tr>"

    cust = lambda d: f"{d['ESS']} / {d['PLUS']} / {d['PROG']}"
    rows = [
        "<tr class='sec'><td colspan='4'>Year 1 (Oct 2026 – Sep 2027; paying starts from month 7)</td></tr>",
        row("Paying customers at year end (Ess / Plus / Prog)", lambda r: cust(r["y1"]["customers"])),
        row("Recognised revenue (subscr. + setup)", lambda r: f"{L(r['y1']['revenue'])} <span class='muted'>({r['y1']['sub'] / 1e5:.1f} + {r['y1']['setup'] / 1e5:.1f})</span>", "b"),
        row("Direct delivery cost (infra, hosting, onboarding)", lambda r: L(r["y1"]["direct"])),
        row("Gross profit (margin)", lambda r: f"{L(r['y1']['gross'])} ({r['y1']['gm']:.0%})"),
        row("Operating expenses (founders unpaid)", lambda r: L(r["y1"]["opex"])),
        row("Operating result, founders unpaid", lambda r: L(r["y1"]["op"]), "b"),
        row("ARR at end of Year 1 (MRR × 12)", lambda r: L(r["y1"]["arr_end"])),
        "<tr class='sec'><td colspan='4'>Year 3 (Oct 2028 – Sep 2029; salaried team)</td></tr>",
        row("Customers at start → end (all tiers)", lambda r: f"{sum(r['y3']['start'].values())} → {r['y3']['n']}"),
        row("Gross new customers (incl. churn)", lambda r: str(r["y3"]["gross_adds"])),
        row("Recognised revenue (subscr. + setup)", lambda r: f"{L(r['y3']['revenue'])} <span class='muted'>({r['y3']['sub'] / 1e5:.1f} + {r['y3']['setup'] / 1e5:.1f})</span>", "b"),
        row("Direct delivery cost (incl. customer success)", lambda r: L(r["y3"]["direct"])),
        row("Gross profit (margin)", lambda r: f"{L(r['y3']['gross'])} ({r['y3']['gm']:.0%})"),
        row("Operating expenses", lambda r: L(r["y3"]["opex"])),
        row("Operating result", lambda r: L(r["y3"]["op"]), "b"),
        row("ARR at end of Year 3", lambda r: L(r["y3"]["arr_end"])),
        row("Break-even customers (Year-3 mix & costs)", lambda r: f"≈ {r['y3']['breakeven']}"),
    ]
    return ("<table class='t small fin'><thead><tr><th></th>" + "".join(f"<th class='num'>{k}</th>" for k in names) +
            "</tr></thead><tbody>" + "".join(rows) + "</tbody></table>")


def impact_table():
    names = list(R)

    def row(label, f, lab):
        return f"<tr><td>{label}</td><td><span class='lab {lab.lower()}'>{lab}</span></td>" + "".join(f"<td class='num'>{f(R[k])}</td>" for k in names) + "</tr>"

    rows = [
        "<tr><td>Deployment (Year-3 customers, Ess / Plus / Prog)</td><td><span class='lab asm'>ASM</span></td>" + "".join(
            f"<td class='num'>{M.SCEN[k]['E']['ESS']} / {M.SCEN[k]['E']['PLUS']} / {M.SCEN[k]['E']['PROG']}</td>" for k in names) + "</tr>",
        row("Water sources monitored", lambda r: n(r["impact"]["sources"]), "ASM"),
        row("Screening records per year", lambda r: n(r["impact"]["records"]), "ASM"),
        row("Flagged results (5%)", lambda r: n(r["impact"]["flagged"]), "ASM"),
        row("Flagged results opened as one owned case", lambda r: n(r["impact"]["owned"]), "TGT"),
        row("Followed up at 18% external benchmark", lambda r: n(r["impact"]["base_done"]), "EXT"),
        "<tr><td>Follow-through target (lab-verified + retest ≤30 days)</td><td><span class='lab tgt'>TGT</span></td>" + "".join(
            f"<td class='num'>{R[k]['impact']['target']:.0%}</td>" for k in names) + "</tr>",
        row("Additional documented follow-ups vs benchmark", lambda r: n(r["impact"]["extra"]), "TGT"),
    ]
    return ("<table class='t small'><thead><tr><th>Per year, at Year-3 deployment</th><th>Label</th>" + "".join(f"<th class='num'>{k}</th>" for k in names) +
            "</tr></thead><tbody>" + "".join(rows) + "</tbody></table>")


# --------------------------------------------------------------------------- feature inventory
# status: V verified on synthetic data | P partial / in progress | H planned for this hackathon | R roadmap | X proposed addition
STATUS = {"V": ("v", "Verified (synthetic)"), "P": ("p", "Partial"), "H": ("h", "Hackathon"), "R": ("r", "Roadmap"), "X": ("x", "Proposed")}
FEATURES = [
    # area, feature, user, problem addressed, status, evidence / planned validation
    ("Field app", "Staff sign-in (Supabase Auth, ES256 verified)", "Worker, supervisor", "Only authorised people create records", "V", "Emulator sign-in against staging, app v2.2 (screenshot); provider tests"),
    ("Field app", "Source catalogue: search, QR allow-list, source history", "Worker", "Test is tied to the right source", "V", "43 Python + 22 Node tests; 10 hostile QR payloads rejected; emulator screens. Independent review owed"),
    ("Field app", "Kit protocol, lot/expiry eligibility, read-window timer (two-clock)", "Worker", "Results read outside the kit's window or with expired reagents", "P", "39 Node tests; runs on synthetic SYN-COLOR-001 only; no real kit yet"),
    ("Field app", "Guided capture with region marking", "Worker", "Unusable or unverifiable photos", "P", "Emulator only; reference-card locator missing; physical phone pending"),
    ("Field app", "Deterministic capture-quality checks and retake path", "Worker", "Guessing from bad photos", "V", "Fixtures 8/8, Kotlin 4/4; thresholds provisional"),
    ("Field app", "Manual reading with provenance, 'screening result only' wording", "Worker", "False certainty; screening mistaken for a lab result", "V", "12/12 review tests; wording tests; screenshots"),
    ("Field app", "On-device model suggestion with calibrated abstention", "Worker", "Reading variability", "P", "Research only: 68-parameter MLP, 896 B; 29/29 emulator parity, 1.7 ms median; synthetic data; not used in live flow"),
    ("Field app", "Crash-safe offline save with local receipt", "Worker", "Records lost when phones die or restart", "V", "Fault injection at commit boundaries; emulator kill -9 in airplane mode"),
    ("Field app", "Idempotent sync and ordered pull", "Worker, supervisor", "Duplicates and lost updates after reconnecting", "V", "Lost-response replay = duplicate, 1 row; PostgreSQL concurrent replay; emulator reconnect"),
    ("Field app", "Offline access lease, clock-rollback lock, revocation", "Programme admin", "Lost/stolen phones keep access offline", "V", "Emulator: 5 h clock rollback locked access, 0 records lost"),
    ("Field app", "Encryption at rest on the phone", "All", "Data exposure on a lost phone", "R", "Production blocker (T32); design choice pending"),
    ("Field app", "Hindi interface, TalkBack pass", "Worker, resident", "Language and accessibility barriers", "R", "T28 not started; static a11y fixes done"),
    ("Case workflow", "Exactly one case per flagged sample", "Supervisor", "Flags that nobody owns", "V", "State-machine tests; journey step 3"),
    ("Case workflow", "Owner, lab referral, due date, overdue visibility", "Supervisor", "No deadline, no accountability", "V", "Case API tests (T17/T18), PostgreSQL race x5"),
    ("Case workflow", "Lab report recorded, then verified by a different person", "Supervisor, lab reviewer", "Unverified or self-approved results", "V", "Self-review refused at API and DB layer; journey step 5"),
    ("Case workflow", "Corrective action with completion evidence", "Operator", "'Fixed' with no proof", "V", "7/7 focused tests"),
    ("Case workflow", "Same-source, later retest linked to the case", "Worker, supervisor", "Closing without re-checking", "V", "g_retest guard tests"),
    ("Case workflow", "Resident communication record (never a delivery claim)", "Supervisor", "Residents never told", "V", "T22 tests; journey step 7-8"),
    ("Case workflow", "Evidence-checked closure with named missing items", "Supervisor", "Premature closure", "V", "Closure refused until verified report + action + retest + communication; closure policy awaits domain sign-off"),
    ("Case workflow", "Metrics and CSV export (formula-injection safe)", "Programme lead", "No view of overdue and repeat problems", "P", "14/14 tests; single-process job store"),
    ("Case workflow", "Supervisor web board", "Supervisor", "Needs a screen, not an API", "P", "API + CORS here; board is a separate app"),
    ("Resident layer", "Resident account (phone + password, lockout, forced change)", "Resident", "Anonymous, untraceable complaints", "P", "HTTP 12/12; phone ownership unverified (no SMS provider)"),
    ("Resident layer", "Complaint with reference number, rate limit; illness report alerts supervisors", "Resident, supervisor", "Complaints that go nowhere", "P", "Verified against the live database; no app screen yet; alert delivery not connected"),
    ("Resident layer", "Complaint linked to a case; +status lookup", "Resident, supervisor", "No feedback to the person who reported", "P", "review_complaint API; IVR intake needs telephony provider"),
    ("Resident layer", "Public source status (fuzzed location, never 'safe to drink')", "Resident", "False reassurance; privacy", "P", "API verified, map refresh by pg_cron observed; app portal shows demo fixtures"),
    ("Resident layer", "Points, rewards, sponsor redemptions, leaderboard", "Resident, sponsor", "Low reporting participation", "P", "Atomic, race-safe redemption proven; no app screen"),
    ("Platform", "Tenant isolation across every /v1 route", "All", "One customer seeing another's data", "V", "Route matrix; cross-tenant ids look like missing ids. Blocker: API uses table-owner role, RLS off"),
    ("Platform", "Safe logging, request tracing, alert runbook", "Operator", "Leaked secrets; silent failures", "P", "Injected secrets never logged; alerts not wired to paging"),
    ("Platform", "Retention with deletion ledger that survives restore", "Operator", "Over-retention of photos and data", "V", "Interrupted purge resumes; restore reapplies deletions"),
    ("Platform", "Backup/restore, rollback with outbox replay, model kill switch", "Operator", "Unrecoverable failures", "P", "Rehearsed on staging; photo backup and scheduled dump missing"),
    ("Platform", "CI and hosted staging", "Team", "Regressions", "V", "CI green; staging smoke 7/7; /health/ready 200 on 25 Sep 2026"),
    ("Demo", "5-minute live story: offline capture → refused closure → evidenced closure", "Judges", "Show the claim, not screens", "H", "Team demo plan; synthetic data visibly labelled"),
    ("Roadmap", "Real kit protocol with domain reviewer; signed closure policy", "Programme", "Scientific and policy validity", "R", "T01/T46; needs a lab/domain partner"),
    ("Roadmap", "Validated kit-specific model on real preparations", "Worker", "Reading variability", "R", "T23-T27 on independent preparations, leave-phone-out tests"),
    ("Roadmap", "SMS / push / IVR delivery", "Resident", "Residents without the app", "R", "Providers B2-B4 not chosen"),
    ("Roadmap", "Shadow pilot and production release", "Operator", "Real-world proof", "R", "T38 protocol drafted; T39 checklist; 10 open blockers"),
    ("Proposed", "Light shield; signed printable case receipt; kit-lot drift warning; voice instructions", "Worker, resident", "Capture quality, literacy, trust", "X", "Team's own E01-E05, explicitly not committed"),
    ("Proposed", "Lab turnaround tracker (referral → verified report, per lab)", "Programme lead", "Audits found 9-106 day delays", "X", "Our suggestion; data already captured by case timestamps"),
    ("Proposed", "Bridge the two case models (mobile-sync cases and v2 reports)", "Team", "Two parallel case records", "X", "Our engineering recommendation before pilot"),
]


def feature_matrix(a=0, b=None):
    rows = []
    last = None
    for area, feat, user, prob, st, ev in FEATURES[a:b]:
        cls, label = STATUS[st]
        if area != last:
            rows.append(f"<tr class='sec'><td colspan='5'>{area}</td></tr>")
            last = area
        rows.append(f"<tr><td><b>{feat}</b></td><td>{user}</td><td>{prob}</td><td><span class='st {cls}'>{label}</span></td><td>{ev}</td></tr>")
    return ("<table class='t small fm'><thead><tr><th style='width:27%'>Feature</th><th style='width:11%'>User</th><th style='width:17%'>Problem addressed</th><th>Status</th>"
            "<th style='width:33%'>Evidence or planned validation</th></tr></thead><tbody>" + "".join(rows) + "</tbody></table>")


def feature_counts():
    from collections import Counter
    cnt = Counter(f[4] for f in FEATURES)
    return "".join(f"<div class='fc'><span class='st {STATUS[k][0]}'>{STATUS[k][1]}</span><b>{cnt[k]}</b></div>" for k in "VPHRX")


def tokens():
    b1, b3 = R["Base"]["y1"], R["Base"]["y3"]
    o3, c3 = R["Optimistic"]["y3"], R["Conservative"]["y3"]
    return {
        "chart_retest": chart_retest(), "chart_tat": chart_tat(), "chart_revenue": chart_revenue(), "chart_impact": chart_impact(),
        "pricing_table": pricing_table(), "scenario_table": scenario_table(), "impact_table": impact_table(),
        "assumptions_table": assumptions_table(), "feature_matrix_1": feature_matrix(0, 21), "feature_matrix_2": feature_matrix(21), "feature_counts": feature_counts(), "ledger_table": ledger_table(), "refs": refs_html(),
        "ess_month": f"₹{T['ESS']['monthly']:,}", "ess_year": f"₹{T['ESS']['monthly'] * 12 / 1e5:.1f} lakh",
        "odk_inr": f"₹{M.ODK_STANDARD_INR_MONTH:,}", "ess_vs_odk": f"{T['ESS']['monthly'] / M.ODK_STANDARD_INR_MONTH:.0%}",
        "be_base": str(b3["breakeven"]), "be_opt": str(o3["breakeven"]), "be_cons": str(c3["breakeven"]),
        "n_base3": str(b3["n"]), "n_opt3": str(o3["n"]), "n_cons3": str(c3["n"]),
        "op_base3": L(b3["op"]), "op_opt3": L(o3["op"]), "rev_base3": L(b3["revenue"]), "arr_base3": L(b3["arr_end"]),
        "rev_base1": L(b1["revenue"]), "arr_base1": L(b1["arr_end"]), "op_base1": L(b1["op"]), "op_base1_paid": L(b1["op_paid_founders"]),
        "gm_base3": f"{b3['gm']:.0%}", "contrib_base": L(b3["contrib"]),
        "adds_base3": str(b3["gross_adds"]),
        "mk_colleges": n(M.COLLEGES), "mk_serv": n(MK["serviceable"]), "mk_reach": n(MK["reachable"]),
        "mk_value": f"₹{MK['reachable_value'] / 1e7:.1f} crore", "mk_share": f"{(M.SCEN['Base']['E']['ESS'] + M.SCEN['Base']['E']['PLUS']) / MK['reachable']:.1%}",
        "im_records": n(R["Base"]["impact"]["records"]), "im_flag": n(R["Base"]["impact"]["flagged"]),
        "im_base": n(R["Base"]["impact"]["base_done"]), "im_tgt": n(R["Base"]["impact"]["tgt_done"]), "im_extra": n(R["Base"]["impact"]["extra"]),
    }


def cites():
    return {f"c:{k}": c(k) for k in IDX}


def build():
    src = (HERE / "template.html").read_text(encoding="utf-8")
    tok = tokens() | cites()
    import re
    missing = set()

    def sub(m):
        k = m.group(1)
        if k not in tok:
            missing.add(k)
            return m.group(0)
        return tok[k]

    out = re.sub(r"\{\{([a-zA-Z0-9_:-]+)\}\}", sub, src)
    assert not missing, f"unknown tokens: {sorted(missing)}"
    (HERE / "jalsakshi-first-review.html").write_text(out, encoding="utf-8")
    (HERE.parent / "jalsakshi-source-and-assumptions-ledger.md").write_text(ledger_md(), encoding="utf-8")
    print("built; refs:", len(REFS), "ledger rows:", len(LEDGER))


if __name__ == "__main__":
    build()
