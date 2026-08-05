# Insurance Snapshot

A single-page React application that helps staff quickly capture and summarize a client's insurance details for a behavioral health or treatment episode — then generates the short cost note that the person relaying costs actually reads to the client, plus the full detail behind it.

---

## Features

- **Plan Basics** — Record network, deductible totals, and out-of-pocket maximum amounts, plus whether they are tracked separately or combined.
- **Level of Care (LOC)** — Track the client's current status (not yet admitted, in treatment, or discharged), their current/most recent LOC, and the verified LOC used for this agreement.
- **Benefits by Level of Care** — A plan holds an independent benefit for each level of care (Detox, Resi, PHP, IOP, OP), and any number of them can be captured from a single verification call. Each records whether the deductible applies, the contracted rate, copay, coinsurance, and a confirmation flag — none of the fields gate each other, so a LOC can carry both a contracted rate and a copay. The Verified LOC selected in Section 2 marks which benefit is primary for this VOB; it does not limit what can be stored.
- **Services During the LOC** — Choose how the plan cost-shares services delivered during the verified LOC: the standard INN bundle (individual therapy, family therapy, and assessment included at $0), separate patient responsibility for every service, or custom/unsure. This sits on top of the per-LOC benefits and decides which LOC benefit a given service uses. Psychiatric services always use the OP benefit, even while the client is enrolled in IOP.
- **Resolved Benefit Engine** — Each service is resolved into a single benefit result (benefit category, responsibility type, patient responsibility, and accumulator behavior) before any output is written, so the staff summary and client explanation cannot contradict each other.
- **Episode Financial Activity** — Log any prior financial activity (client payments, scholarships, hardship assistance) tied to a LOC, with flags for whether each entry counts toward the deductible or OOP max.
- **Running Calculations** — Automatically computes deductible remaining, OOP remaining, and total episode activity applied to OOP.
- **Cross-LOC Warning** — Flags when the verified LOC differs from the current/most recent LOC so staff know prior activity is being carried forward.
- **Final Check** — Checklist confirming all key fields have been reviewed before submission.
- **Copay Capped at the Contracted Rate** — A plan's stated copay is never collected above the level of care's contracted rate, because we cannot charge more than we contracted for. A $50 copay against a $40 contracted rate is collected as $40, and the note says why.
- **Per-Admission Copays** — A per diem level of care (Detox, Resi) can carry a single copay for the whole stay rather than one per day. Which one it is has to be stated, since the difference is one charge versus one charge per day.
- **Three Outputs, One Engine** — Every submission produces a **Cost Note**, a **Staff Detail** breakdown, and a **Client Explanation**, all resolved from the same benefit objects so they cannot disagree. Each can be copied to the clipboard.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | React 19 |
| Build | Vite 8 |
| Linting | ESLint 9 |

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

## How to Use

1. **Fill in Plan Basics** — Enter the insurance network, deductible amounts, and out-of-pocket maximum.
2. **Set Level of Care** — Select the client's current status, most recent LOC, and the verified LOC for this episode.
3. **Enter Benefits by Level of Care** — The verified LOC's card appears automatically. Specify whether the deductible applies, enter copay and coinsurance (or mark them N/A), and record the contracted rate when known. Use **+ Add Another LOC Benefit** for any other level of care the verification call covered — add OP if the client may receive psychiatric visits. Then select how services during the verified LOC are bundled.
4. **Add Episode Financial Activity** — Use the "+ Add Activity" button to log any prior financial activity for the episode.
5. **Complete the Final Check** — Check off each item to confirm everything has been reviewed.
6. **Generate the Snapshot** — Submitting produces three views of the same result:
   - **Cost Note** — the default. A handful of lines saying what each thing costs, in the shape the billing team already writes by hand. This is the part that gets read to the client.
   - **Staff Detail** — the full VOB breakdown, collection instructions, and accumulator behavior.
   - **Client Explanation** — long-form plain-language wording for when the client asks how their plan works.

### What the Cost Note leaves out

The cost note answers one question per line — "what does this cost?" — and nothing else. Deductibles, accumulators, network, and episode history appear only where they change a number the client has to pay. Two rules keep it short:

- A service only gets its own line when its price differs from the level of care it happens in. `IOP: no cost.` already covers everything bundled into IOP.
- Services that cost the same share a line.

A price the plan has not established is never guessed at. It is listed under a "do not quote" warning instead.

