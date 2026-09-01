# Insurance Snapshot

A single-page React application for the money side of a behavioral health admission. It holds three tools over one shared rate sheet:

| Tool | What it answers |
|------|-----------------|
| **Deposit Estimator** | "What deposit do we collect up front, and what do I tell the client?" — prices a whole treatment sequence against the plan, and writes the cost note read out loud. |
| **Self-Pay & Scholarship** | "What does this cost without insurance, and how big is the scholarship?" |
| **Rate Sheet** | "What does this carrier pay for this code?" |

Each tool keeps its own state for the session, so switching tabs to check a rate never costs a half-filled form.

---

## Reference data

`src/data/rates.js` is generated from the 2026 Deposit Calculator workbook's `Vlookup` sheet: **63 carriers** with their INN / OON / self-pay status, **122 CPT and HCPCS codes** with descriptions, the **carrier × code rate matrix**, the cross-carrier benchmark average per code, and the **47 treatment sequences**.

`rates.js` is generated and is overwritten whenever the workbook is re-exported, so a rate the workbook has **wrong** is corrected in `src/data/rateCorrections.js` instead — an overlay applied at lookup time, where a hand edit cannot be silently reverted. Each entry records the old value, the date and the reason. A rate the workbook is merely *missing* is not corrected there; it is left missing so the app can say so.

A carrier that has no rate for a code is *absent* from that carrier's row rather than stored as `0`. The workbook marks those cells amber and tells you to estimate from a similar plan; the app does the same thing out loud — it names every priced service whose rate is missing, shows the cross-carrier average and the nearest comparable plans, and warns that the total is understated until a rate is entered. Nothing is silently priced at zero.

### Observed reimbursement — the fallback of last resort

`src/data/reimbursement.js` holds the average amount actually reimbursed per code for **13 payer groups**, drawn from past claims, alongside the average charge amount.

This is the weakest source and the last one consulted. A contracted schedule is a signed number and the carrier table is a plan's stated allowed amount; this is neither. Measured against the carrier table where both exist, it tracks closely in the middle (median ratio **0.96**) but ranges from roughly half to two-thirds above — an estimate, not a quote. Every line drawn from it is tagged `payer avg` on its row, and the result panel names those lines and says the total is an estimate.

**`Misc` is not a fallback.** It is the bucket a plan the app does not carry reports under, so a listed carrier never silently inherits it — a named plan with no rate of its own gets no rate, not somebody else's average. Two things reach it, both deliberately:

- The carrier list ends with **"Other — not listed"**, for a plan the app does not carry. It prices entirely off Misc, states plainly that nothing is specific to the client, and asks for the network status, since an unlisted carrier has none on file.
- A missing rate on a listed carrier shows a one-click **`misc`** button beside its field, alongside the option to type the number the verification call established. Either way the choice is the user's and the source is visible.

With Misc held back this way, **16 of the 176** carrier-table gaps fill automatically from the carrier's own payer group; the other 160 offer the quick-fill. 23 carriers map to no payer group at all and rely on a typed rate or the Misc button.

### In-network contracted rate schedules

`src/data/contractRates.js` holds the signed rate sheets by facility location — **Connecticut** (effective 7/24/2026), **New Jersey — Ramsey** (7/6/2024), and **New York** (12/06/2024) — with both the contracted and billed rate for every code.

These are a different axis from the carrier table. That table answers *"what does this payer allow?"*; a schedule answers *"what have we contracted to be paid here?"* Which schedule applies is a fact about the **site the client is admitting to**, so the estimator asks for a **Location** — Canaan, Wilton, Ramsey, New York City, Chappaqua, Huntington, Mass Virtual — and derives the schedule from it. Mass Virtual has no schedule on file (there is no MA rate sheet), which the app says rather than leaving blank. Rates then resolve in three tiers, and every row shows which tier its number came from:

1. **Override** — a rate typed in by hand, because the user is looking at the contract
2. **Contracted schedule** — a signed rate for this site, **in network only**
3. **Carrier table** — this plan's stated allowed amount
4. **The carrier's own payer-group average** — what claims like this were actually paid

A code none of the four covers stays missing rather than becoming zero. A contracted schedule is an in-network agreement, so it prices nothing for an out-of-network plan however the location is set — there is no contract with a payer we are out of network with, and the allowed amount is that plan's own. The Location field says so rather than looking ignored. Only Connecticut carries facility per diems; the NJ and NY sheets are professional rates only, so detox, residential, PHP and OPWM fall back to the carrier table there. Codes a schedule lists as *billed but not contracted* (Utox, Case Management, Medical Team Conference, telephone codes) are flagged as **not contracted** rather than merely unpriced — the plan may not pay them at all.

Connecticut contracts **H0018 at two rates** against two revenue codes — $1,186.00 under rev 1000 (Residential 3.7 / Residential Eval) and $1,045.00 under rev 1002 (Residential 3.5 / Residential). The residential line prices at the 1002 rate, matching how the workbook's own table labels H0018, and the app surfaces the other rate on screen so it can be entered when a stay bills that way.

---

## Deposit Estimator

A port of the workbook's `Insurance Calculator_v2` sheet. It runs two cost-share waterfalls, and the inpatient one runs first because it consumes the deductible and out-of-pocket room the outpatient one then works against:

```
allowed cost → deductible → coinsurance → copay → OOP cap → deposit
```

- **Treatment sequence gating** — a level of care is priced only when the selected sequence names it.
- **Sequenced deductible** — detox takes what it can, residential takes what detox left, and the outpatient block starts from the remainder.
- **The three copay questions**, each of which moves money on its own: how it is counted (per unit, professional visits only, or a manual total), whether it displaces coinsurance, and which accumulators it feeds. **Every one of them can be answered per level of care** — see below.
- **Accumulator routing** — whether the deductible and the admission fee sit inside or outside the out-of-pocket cap changes what is still collected after the maximum is reached.
- **Admission fees per level of care**, charged only for the levels in the sequence.
- **Sequence-aware unit defaults** — a typical episode is not one schedule:

  | | Intake | IOP | Groups | Specialty groups | IT | Psych eval | Psych F/U | FT |
  |---|---|---|---|---|---|---|---|---|
  | **IOP** | 1 | 30 | — | — | 9 | 1 | 2 | — |
  | **OP** | 1 | — | 10 | 10 | 10 | 1 | 2 | 3 |

  A sequence covering both sums the therapy and group counts — `IOP > OP` gives 19 individual sessions — but the **psychiatric services are one course for the admission**, so intake, the evaluation and the follow-ups take the larger of the two rather than starting a second course. Every count is editable, changing the sequence re-bases anything not typed over, and a **Reset counts** action restores the defaults.
- **Editable nights and rates** — a rate entered by hand outranks both the contracted schedule and the carrier table, and is tagged as an override.

The result panel carries the deposit as a hero figure, its inpatient / outpatient / prior-balance split, a part-to-whole breakdown of what created each dollar of the client's responsibility, and both waterfalls line by line so any number can be checked rather than trusted. Every figure it shows is one the client is actually charged: where a copay replaced coinsurance or was credited to the deductible, the row says how much moved rather than quoting an amount the estimate computed and never collected.

### Rules per level of care

The workbook states the plan's terms once and applies them to the whole episode. A benefit check is not always that tidy, and the case that breaks a single set of terms is an ordinary one:

> The IOP course is billed against the deductible and coinsured on the contracted rate — **$305 a session until the deductible is met, then 20% of it**. The psychiatry delivered alongside it is outpatient care: a **$20 copay a visit that never touches the deductible** and feeds only the out-of-pocket maximum.

One plan-wide answer cannot hold both — "replace coinsurance" for the copay would wipe out the coinsurance the IOP course is charging. So each level of care can state its own: whether the **deductible applies**, the copay **amount** and **basis**, whether that copay **replaces or adds to coinsurance**, whether it is **credited to the deductible**, and whether it **counts toward the out-of-pocket maximum**. Anything a level does not answer it reads from the plan.

The waterfall then adds the levels up rather than applying one answer to the block: the deductible is spent in the order care is delivered, skipping any level that waives it, and each level's charge is counted the way that level's own answers say. Where every level is on the plan's terms, each of those sums collapses back to the workbook's single expression — which is why an estimate with nothing overridden is still exactly the workbook's estimate.

**Psychiatry is outpatient care wherever it is delivered.** A psychiatric evaluation or follow-up during an IOP course is an OP visit and is charged under OP's terms, so OP is a level of the estimate even in a sequence that never names it — the rules panel shows it, and the service row says where it is billed. A copay is not a rate: the rate column is the plan's **allowed amount**, and the column beside it is what the client pays for one more unit under the rules of the level it bills at.

### The OP specialty group

The specialty group bills **CPT 90853**, the same code as the routine OP group, and against insurance that is the whole story: the plan allows one amount per group and does not distinguish the curriculum. So the two rows resolve to one rate, an override typed into either rate cell moves both, and the row says so on screen. It is a separate row only because the counts differ: the specialty track and the routine groups each get their own share of the OP week. An OP course starts at **10 of each** — the same twenty groups the workbook carried on a single row, split across the two rows the schedule actually runs — so an OP episode prices identically at the default counts, and moving a group between the rows never moves the estimate.

Self-pay is the one place the two prices part company: there the specialty group is a **flat $100**, written down rather than looked up, because one code cannot carry two self-pay rates in the rate table.

### Generating the output

The estimator prices the episode; **Generate output** hands it over. It produces three views of the same estimate, each copyable:

- **Cost Note** — the default. What to read to the client: the deposit, what it is made of, and nothing else. Money that did not move is not named — a plan with no copay gets no copay line — and the pieces it does list reconcile to the deposit, with the out-of-pocket maximum shown as the subtraction it is where it caps the total.
- **Staff Detail** — the plan terms as entered, every priced line with its units and rate, both waterfalls line by line, and any code the estimate could not price.
- **Client Explanation** — long-form plain-language wording, for when the client asks how their plan works.

The note refuses to quote what the estimate cannot stand behind. An unfinished estimate produces a **DO NOT QUOTE** list of what is missing instead of a total, and a service with **no rate on file** is named with what its absence does to the number — the total is understated, not merely uncertain. A line priced from average paid claims rather than a rate for this plan is flagged as an estimate rather than a quote.

### Where this deliberately differs from the workbook

The workbook is internally inconsistent in three places. Each is implemented the coherent way, matching the workbook's own written notes (E42/E43, B24) and its `Self Pay Calc` sheet:

1. **Shared professional services activate on IOP *or* OP.** The workbook gates assessment, individual therapy, psychiatry, family therapy and MATs on IOP alone in the cost cells. An OP-only sequence therefore priced a client's assessment and psychiatry at nothing.
2. **Copay units follow the lines that were actually costed.** The workbook's copay-unit formula counts OP groups under the IOP branch and individual therapy under the OP branch — the two are swapped relative to the cost formulas.
3. **A bundled INN IOP agreement charges for IOP and folds in the intake, individual therapy and family therapy** — what the workbook's own note in B24 says, since confirmed and extended to the intake. Its copay-unit formula excludes IOP services instead. The bundle is an IOP agreement, so it reaches only what IOP delivers: therapy after a step-down to OP is billed like any other OP service, and psychiatry is never in the bundle.

Everything else matches the workbook cell for cell: **600 randomized scenarios × 21 cells** reproduce it exactly, and the inpatient block matches in all 800 scenarios including the divergent ones. The per-level rules are a superset rather than a departure — with nothing overridden, the same scenarios still reproduce it.

---

## Self-Pay & Scholarship

A port of the `Self Pay Calc` sheet. The client's payment is applied to each line first; the scholarship is whatever the payment did not reach. The point of the sheet is the *shape* of that gap, so the scholarship is restated three ways — as a percentage of the program, as units of care covered, and as a blended daily rate — because those are the units a scholarship gets approved in.

Two of its counts are the estimator's rather than the workbook's. **Individual therapy starts at 10 sessions**, the OP course, where the workbook's 18 belonged to no single level of care and quoted an OP episode nearly two courses of therapy. The **OP specialty group** is priced at a flat **$100** rather than the sheet's own rate for 90853. Every count is editable, so a longer course is typed in rather than assumed.

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
| `npm test` | Run the test suite (107 tests, Node's built-in runner — no extra dependencies) |
| `npm run lint` | Run ESLint across all source files |

---

## Tests

`npm test`. Deploys run lint and the suite before building, so a wrong quote cannot ship.

The suite is built around one question — **does the output say what was entered?** — and answers it three ways:

- **Against the workbook.** 60 scenarios captured from a literal transcription of the original cell formulas, each carrying all 21 intermediate cells, so a regression is located rather than merely detected. The self-pay sheet's own saved scenario is asserted to the cent.
- **At named points.** Sequence gating, the sequence-aware unit defaults, rate sourcing and its four levels of authority, the contracted schedules, and every state the estimator must refuse to quote.
- **Through the generated output.** The cost note's deposit is asserted to be the computed one, its breakdown to reconcile to that deposit, and a charge the plan does not have to be absent rather than printed as $0 — a copay that replaces coinsurance is never quoted alongside coinsurance, and an unpriced code always reaches the note.

---

## How to Use the Deposit Estimator

1. **Plan & Pathway** — Select the carrier, its network status where the carrier has none on file, the location the client is admitting to, and the treatment sequence. The sequence decides which levels of care are priced at all; everything else stays at zero.
2. **Accumulators** — What is left of the plan year as of today: deductible remaining, out-of-pocket maximum remaining, the coinsurance percentage, and whether the deductible sits inside the maximum or on top of it. Any previous outstanding balance goes here too.
3. **Copay** — Three separate questions, each of which moves money on its own: how the copay is counted, whether it displaces coinsurance, and which accumulators it feeds. A copay whose accumulator behavior has not been established is a blocker, not a default — it would otherwise drop out of the deposit entirely.
4. **Admission Fees** — Charged once on entry to a level of care, and only for the levels the sequence names.
5. **Inpatient Nights and Outpatient Services** — Counts start from the typical episode for the sequence and every one is editable, as is every rate: a number from the verification call outranks both the contracted schedule and the carrier table, and is tagged as an override.
6. **Generate the output** — Once nothing is left in *Resolve before quoting*, the deposit is quotable. **Generate output** produces the three views:
   - **Cost Note** — the default. The deposit and what makes it up, in the shape the billing team already reads out. This is the part that gets read to the client.
   - **Staff Detail** — the plan terms as entered, every priced line, and both waterfalls line by line.
   - **Client Explanation** — long-form plain-language wording for when the client asks how their plan works.

### What the Cost Note looks like

```
Oxford (in network) — Detox > Residential > IOP > OP.

Deposit: $8,228.

  Detox and Residential, 20 nights: $5,569.
  IOP and OP: $2,660.

What makes that up:
  Deductible: $1,500.
  Coinsurance, 20% of the cost after the deductible: $6,728.

This is an estimate of the plan's cost share for the care listed above, not a bill. What is owed in the end follows the care actually delivered.
```

It answers one question per line — "what does this cost?" — and nothing else. Two rules keep it short:

- **Money that did not move is not named.** No copay on the plan, no copay line. No admission fee, no fee line. A single level of care and no prior balance gets no split, because the split would only restate the number above it. A zero in front of a client is a number they have to think about for nothing.
- **Nothing is described in the abstract.** Every line carries the figure it is about, so no sentence needs the one after it to mean anything. The pieces listed reconcile to the deposit, and where the out-of-pocket maximum holds the total down it is shown as the subtraction it is rather than left as a gap between a list and the number over it.

The amounts quoted are the ones actually charged, not the ones the waterfall started from: a copay credited to the deductible is not collected as deductible as well, and a copay that replaces coinsurance leaves no coinsurance behind it.

### What it refuses to quote

A price the estimate cannot stand behind is never read out. An estimate that is not finished produces the blockers instead of a total:

```
DO NOT QUOTE — the estimate is not complete.

  Select an insurance carrier
  Enter the coinsurance percentage (enter 0 if the plan has none)

Finish the estimate and generate the output again.
```

And a service nobody has priced is named, with what its absence does to the number — it is costing $0 in a total that is therefore understated, which is a different problem from an uncertain one:

```
Do not quote yet — 5 services are priced at $0 because no rate is on file:
Initial Assessment (90791), IOP Services (H0015), Individual Therapy (90837),
Psychiatric Evaluation (90792), Psychiatric Follow Up (99214).
The real deposit is higher than the figure above.
```

A line priced from average paid claims rather than a rate for this plan is flagged the same way, as an estimate rather than a quote.
