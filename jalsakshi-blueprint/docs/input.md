# Project input snapshot — supplied by team

Updated: 22 September 2026 IST. This records the team's current inputs, not completed validation or a purchasing recommendation.

## Team and build setup

- Team: three people, comfortable with AI-assisted coding and using Astra/Fable as development tools.
- Laptops: Windows 11, 16 GB RAM, with available storage. Exact CPU, GPU, Node/JDK and Android SDK versions will be captured during native setup.
- Device connectivity: USB cables, Developer Mode and USB debugging are available.
- Mobile priority: Android first. The main demonstration phone may be a Xiaomi/Redmi or OnePlus device; both current and previous-generation models are intended targets. Exact model, Android version, ABI, RAM and storage must be recorded on the first device run and a second device run.
- iPhone: available for later compatibility exploration. It is not the primary build or demonstration target. A Windows laptop cannot locally produce a standard iOS/Xcode build; iOS is later scope, not a current delivery promise.

## Water-testing scope

- The college will not provide a kit. The team can spend approximately **₹2,000** on basic kits and would prefer multiple kits when useful.
- Product ambition: support a multi-parameter field workflow, including pH, chlorine, nitrate, fluoride and other parameters supported by the ultimately selected kit.
- Practical delivery rule: each parameter and kit needs its own manufacturer protocol, read timing, chart/reference, lot/expiry handling and evaluation. The first automated-assistance implementation must validate **one parameter at a time**. Multi-parameter record capture can be built earlier; it is not proof that every parameter is analytically validated.
- Before a real kit is purchased/approved: use a clearly labeled synthetic demonstration protocol with a printed reference card and harmless colored-water/sample imagery to exercise capture, offline persistence, synchronization and case flow. It must never be described as a real water-safety result.
- No laboratory, faculty water expert or field-program contact is currently available. Research guides early design; it cannot substitute for lab confirmation or a domain review in a real pilot.

## Product, language and hosting

- Required experience: source-level water-test workflow, offline capture, guided/manual entry, uncertainty, supervisor review, referral/action/retest/closure trail, audit/export and a website dashboard.
- Languages: English and Hindi from the initial product scope; translations need review before real field use.
- Supervisor dashboard: must run locally on a laptop and be capable of later online access as a website.
- Current monthly hosting budget: **₹0**. Early development/demo should run locally or on a genuinely free service tier only if its terms, privacy limits and availability fit. Paid hosting, production reliability and traffic-scale assumptions are future scope.

## Hackathon status and integrity boundary

- Participation, selection status and organizer pre-event-work rules are not confirmed.
- The prototype is being prepared in advance. Build records must keep that work traceable; any event submission or presentation must comply with organizer rules and must not misrepresent when work was completed.

## Remaining facts to capture during implementation

1. Exact Redmi and OnePlus model/Android version for tested devices.
2. Chosen kit manufacturer/model, supported parameters, lot/expiry, purchase receipt and instructions.
3. Which parameter is first for automated assistance and who approves its protocol.
4. Actual disk/RAM/CPU use and supported-device results from release APK runs.
5. Any lab, supervisor, worker or program contact acquired later.
6. A written retention/privacy decision before real photos, locations or personal data are collected.

## Planning interpretation

The project should be designed for broad Android compatibility, but support is earned through tests: first the two available Android phones, then an additional device if acquired. “Works on Android” does not mean every Android model, camera or kit is already validated.

The current lowest-cost path is: Android APK + local dashboard for development; synthetic data for the demo path; optional free online preview only after its security restrictions are reviewed. The full online multi-user product, validated local AI and all-parameter claims remain later milestones in [implementation-plan.md](../implementation-plan.md).
