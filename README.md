# Insurance Snapshot

A single-page React application for the money side of a behavioral health admission. It holds four tools over one shared rate sheet:

| Tool | What it answers |
|------|-----------------|
| **Snapshot** | "What do I tell this client their care costs?" — captures a verification and writes the cost note read out loud. |
| **Deposit Estimator** | "What deposit do we collect up front?" — prices a whole treatment sequence against the plan. |
| **Self-Pay & Scholarship** | "What does this cost without insurance, and how big is the scholarship?" |
| **Rate Sheet** | "What does this carrier pay for this code?" |

Each tool keeps its own state for the session, so switching tabs to check a rate never costs a half-filled form.

---

## Reference data

`src/data/rates.js` is generated from the 2026 Deposit Calculator workbook's `Vlookup` sheet: **63 carriers** with their INN / OON / self-pay status, **122 CPT and HCPCS codes** with descriptions, the **carrier × code rate matrix**, the cross-carrier benchmark average per code, and the **47 treatment sequences**.

A carrier that has no rate for a code is *absent* from that carrier's row rather than stored as `0`. The workbook marks those cells amber and tells you to estimate from a similar plan; the app does the same thing out loud — it names every priced service whose rate is missing, shows the cross-carrier average and the nearest comparable plans, and warns that the total is understated until a rate is entered. Nothing is silently priced at zero.

### In-network contracted rate schedules

`src/data/contractRates.js` holds the signed rate sheets by facility location — **Connecticut** (effective 7/24/2026), **New Jersey — Ramsey** (7/6/2024), and **New York** (12/06/2024) — with both the contracted and billed rate for every code.

These are a different axis from the carrier table. That table answers *"what does this payer allow?"*; a schedule answers *"what have we contracted to be paid here?"* Which schedule applies is a fact about the **site the client is admitting to**, so the estimator asks for a **Location** — Canaan, Wilton, Ramsey, New York City, Chappaqua, Huntington — and derives the schedule from it. Rates then resolve in three tiers, and every row shows which tier its number came from:

1. **Override** — a rate typed in by hand, because the user is looking at the contract
2. **Contracted schedule** — a signed rate for this site
3. **Carrier table** — what this payer has been observed to allow

Only Connecticut carries facility per diems; the NJ and NY sheets are professional rates only, so detox, residential, PHP and OPWM fall back to the carrier table there. Codes a schedule lists as *billed but not contracted* (Utox, Case Management, Medical Team Conference, telephone codes) are flagged as **not contracted** rather than merely unpriced — the plan may not pay them at all.

Connecticut contracts **H0018 at two rates** against two revenue codes — $1,186.00 under rev 1000 (Residential 3.7 / Residential Eval) and $1,045.00 under rev 1002 (Residential 3.5 / Residential). The residential line prices at the 1002 rate, matching how the workbook's own table labels H0018, and the app surfaces the other rate on screen so it can be entered when a stay bills that way.

---

## Deposit Estimator

A port of the workbook's `Insurance Calculator_v2` sheet. It runs two cost-share waterfalls, and the inpatient one runs first because it consumes the deductible and out-of-pocket room the outpatient one then works against:

```
allowed cost → deductible → coinsurance → copay → OOP cap → deposit
```

- **Treatment sequence gating** — a level of care is priced only when the selected sequence names it.
- **Sequenced deductible** — detox takes what it can, residential takes what detox left, and the outpatient block starts from the remainder.
- **The three copay questions**, each of which moves money on its own: how it is counted (per unit, professional visits only, or a manual total), whether it displaces coinsurance, and which accumulators it feeds.
- **Accumulator routing** — whether the deductible and the admission fee sit inside or outside the out-of-pocket cap changes what is still collected after the maximum is reached.
- **Admission fees per level of care**, charged only for the levels in the sequence.
- **Sequence-aware unit defaults** — a typical episode is not one schedule:

  | | Intake | IOP | Groups | IT | Psych eval | Psych F/U | FT |
  |---|---|---|---|---|---|---|---|
  | **IOP** | 1 | 30 | — | 9 | 1 | 2 | — |
  | **OP** | 1 | — | 20 | 10 | 1 | 2 | 3 |

  A sequence covering both sums the recurring services — `IOP > OP` gives 19 individual sessions — but **intake and the psychiatric evaluation are once per admission**, so a step-down takes the larger of the two rather than billing a second one. Every count is editable, changing the sequence re-bases anything not typed over, and a **Reset counts** action restores the defaults.
- **Editable nights and rates** — a rate entered by hand outranks both the contracted schedule and the carrier table, and is tagged as an override.

The result panel carries the deposit as a hero figure, its inpatient / outpatient / prior-balance split, a part-to-whole breakdown of what created each dollar of the client's responsibility, and both waterfalls line by line so any number can be checked rather than trusted.

### Where this deliberately differs from the workbook

The workbook is internally inconsistent in three places. Each is implemented the coherent way, matching the workbook's own written notes (E42/E43, B24) and its `Self Pay Calc` sheet:

1. **Shared professional services activate on IOP *or* OP.** The workbook gates assessment, individual therapy, psychiatry, family therapy and MATs on IOP alone in the cost cells. An OP-only sequence therefore priced a client's assessment and psychiatry at nothing.
2. **Copay units follow the lines that were actually costed.** The workbook's copay-unit formula counts OP groups under the IOP branch and individual therapy under the OP branch — the two are swapped relative to the cost formulas.
3. **A bundled INN IOP agreement charges for IOP and excludes individual and family therapy** — what the workbook's own note in B24 says, since confirmed. Its copay-unit formula excludes IOP services instead.

Everything else matches the workbook cell for cell: **600 randomized scenarios × 21 cells** reproduce it exactly, and the inpatient block matches in all 800 scenarios including the divergent ones.

---

## Self-Pay & Scholarship

A port of the `Self Pay Calc` sheet. The client's payment is applied to each line first; the scholarship is whatever the payment did not reach. The point of the sheet is the *shape* of that gap, so the scholarship is restated three ways — as a percentage of the program, as units of care covered, and as a blended daily rate — because those are the units a scholarship gets approved in.

---

## Snapshot

The original tool, unchanged. Its features:

- **Plan Basics** — Record network, deductible totals, and out-of-pocket maximum amounts, plus whether they are tracked separately or combined.
- **Level of Care (LOC)** — Track the client's current status (not yet admitted, in treatment, or discharged), their current/most recent LOC, and the verified LOC used for this agreement.
- **Benefits by Level of Care** — A plan holds an independent benefit for each level of care (Detox, Resi, PHP, IOP, OP), and any number of them can be captured from a single verification call. Each records whether the deductible applies, the contracted rate, copay, coinsurance, whether telehealth is covered, and a confirmation flag — none of the fields gate each other, so a LOC can carry both a contracted rate and a copay. The Verified LOC selected in Section 2 marks which benefit is primary for this VOB; it does not limit what can be stored.
- **Services During the LOC** — Choose how the plan cost-shares services delivered during the verified LOC: the standard INN bundle (individual therapy, family therapy, and assessment included at $0), separate patient responsibility for every service, or custom/unsure. This sits on top of the per-LOC benefits and decides which LOC benefit a given service uses. Psychiatric services always use the OP benefit, even while the client is enrolled in IOP.
- **Resolved Benefit Engine** — Each service is resolved into a single benefit result (benefit category, responsibility type, patient responsibility, and accumulator behavior) before any output is written, so the staff summary and client explanation cannot contradict each other.
- **Episode Financial Activity** — Log any prior financial activity (client payments, scholarships, hardship assistance) tied to a LOC, with flags for whether each entry counts toward the deductible or OOP max.
- **Running Calculations** — Automatically computes deductible remaining, OOP remaining, and total episode activity applied to OOP.
- **Cross-LOC Warning** — Flags when the verified LOC differs from the current/most recent LOC so staff know prior activity is being carried forward.
- **Final Check** — Checklist confirming all key fields have been reviewed before submission.
- **Copay Capped at the Contracted Rate** — A benefit's copay applies to every service billing under it, and is never collected above the level of care's own contracted rate, because we cannot charge more than we contracted for. A $50 OP copay against a $40 group rate is collected as $40 for groups while every other OP service keeps the $50, and the note says why.
- **Telehealth per LOC Benefit** — Each level of care records whether the plan covers its own service over telehealth — groups under OP, the program day elsewhere. The outputs stay quiet when it is covered and call it out when it is not, naming the service rather than the whole benefit.
- **Per-Admission Copays** — A per diem level of care (Detox, Resi) can carry a single copay for the whole stay rather than one per day. Which one it is has to be stated, since the difference is one charge versus one charge per day.
- **Three Outputs, One Engine** — Every submission produces a **Cost Note**, a **Staff Detail** breakdown, and a **Client Explanation**, all resolved from the same benefit objects so they cannot disagree. Each can be copied to the clipboard.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | React 19 |
| Build | Vite 8 |
| Linting | ESLint 9 |
| Styling | Hand-written CSS on a token system — light and dark, no framework |

The visual system lives in `src/App.css`. Colors are defined once as roles on `:root`, and only the roles are redefined for dark mode. The four `--series-*` slots used by part-to-whole breakdowns are a colorblind-validated categorical palette; every segment that wears one is also labeled with its own value, so hue is never the only thing telling two of them apart.

---

## Getting Started

### Prerequisites

- Node.js 18 or later
- npm

### Install dependencies

```bash
npm install
```

### Run the development server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the local development server with hot module replacement |
| `npm run build` | Build the app for production (output in `dist/`) |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint across all source files |

---

## How to Use the Snapshot

1. **Fill in Plan Basics** — Enter the insurance network, deductible amounts, and out-of-pocket maximum.
2. **Set Level of Care** — Select the client's current status, most recent LOC, and the verified LOC for this episode.
3. **Enter Benefits by Level of Care** — The verified LOC's card appears automatically. Specify whether the deductible applies, enter copay and coinsurance (or mark them N/A), record the contracted rate when known, and check **Telehealth covered** once the plan confirms telehealth for that level of care's own service. Use **+ Add Another LOC Benefit** for any other level of care the verification call covered — add OP if the client may receive psychiatric visits. Then select how services during the verified LOC are bundled.
4. **Add Episode Financial Activity** — Use the "+ Add Activity" button to log any prior financial activity for the episode.
5. **Complete the Final Check** — Check off each item to confirm everything has been reviewed.
6. **Generate the Snapshot** — Submitting produces three views of the same result:
   - **Cost Note** — the default. A handful of lines saying what each thing costs, in the shape the billing team already writes by hand. This is the part that gets read to the client.
   - **Staff Detail** — the full VOB breakdown, collection instructions, and accumulator behavior.
   - **Client Explanation** — long-form plain-language wording for when the client asks how their plan works.

### What the Cost Note looks like

```
IOP: no cost.
Psych services during IOP: $50 copay.
OP LOC: Groups $40 copay. All other services $50 copay.
```

It answers one question per line — "what does this cost?" — and nothing else. Deductibles, accumulators, network, and episode history appear only where they change a number the client has to pay. Three rules keep it short:

- A service is only named when its price differs from the level of care it happens in. `IOP: no cost.` already covers everything bundled into IOP.
- Services that cost the same are named together, and when every remaining service costs the same they become "all other services" — but only when every service was actually priced, so an uncaptured psych benefit is never quoted by implication.
- The level of care's own service is named on the same terms. `OP: $50 copay.` is the whole OP benefit; `Groups` appears only once the contracted rate prices groups below the copay and leaves the rest of OP at a different number.
- A level of care other than the verified one gets a single line with its services inline. It is reference information, not today's price.

A price the plan has not established is never guessed at. It is listed under a "do not quote" warning instead.

### Group rates

A benefit's copay applies to **every service billing under it**. An OP copay is charged on individual therapy, family therapy, assessment, and psychiatric visits exactly as it is on a group — it is not a group-only price, and the outputs do not describe it as one:

```
OP: $50 copay.
```

A level of care's contracted rate is the rate for that level of care's own service, and it caps that service's copay alone. For OP that service is the routine **group** visit, so the form labels the field `Contract Rate — Groups`. A rate coming in *under* the copay is the only thing that prices groups apart from the rest of the benefit, because we cannot collect more than we contracted for — and only then is the group named:

```
OP: Groups $40 copay.
All other services during OP: $50 copay.

Note: The plan lists a $50 OP copay, but our contracted rate for groups is $40. …
```

A rate at or above the copay changes nothing, since individual therapy, family therapy, assessment, and psychiatric visits bill under their own codes at their own rates and keep the copay either way.

### Telehealth

Each LOC benefit carries a **Telehealth covered** checkbox, scoped to that level of care's own service and labeled the same way the contract rate is — `Telehealth covered — Groups`. A telehealth exclusion lands on a code, not on a benefit: a plan that will not pay a group over telehealth still pays the individual therapy session billing under the same benefit, so the flag says nothing about individual therapy, family therapy, assessment, or psychiatric visits. Telehealth for those is not captured.

Only the exclusion is ever said out loud. A covered service is the service already quoted, at the cost sharing already stated, so it adds no line; an uncaptured benefit claims neither. A plan with no group telehealth benefit at any level reads:

```
IOP: $75 copay.
Individual therapy, family therapy, and assessment during IOP: no cost.
Psych services during IOP: $50 copay.
IOP is not covered over telehealth — IOP must be attended in person.
PHP LOC: $100 copay. PHP is not covered over telehealth.
OP LOC: Groups $40 copay. All other services $50 copay. Groups are not covered over telehealth.
```

