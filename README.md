# Insurance Snapshot

A single-page React application that helps staff quickly capture and summarize a client's insurance details for a behavioral health or treatment episode — then generates a plain-language explanation that can be shared directly with the client.

---

## Features

- **Plan Basics** — Record network, deductible totals, and out-of-pocket maximum amounts, plus whether they are tracked separately or combined.
- **Level of Care (LOC)** — Track the client's current status (not yet admitted, in treatment, or discharged), their current/most recent LOC, and the verified LOC used for this agreement.
- **LOC Rules** — Capture whether the deductible applies, plus copay, coinsurance, and contract rate for the verified LOC. Copay and coinsurance are each entered or explicitly marked N/A so the app can resolve which cost-sharing type actually applies.
- **Services During the LOC** — Choose how the plan cost-shares services delivered during the verified LOC: the standard INN bundle (individual therapy, family therapy, and assessment included at $0), separate patient responsibility for every service, or custom/unsure.
- **Secondary OP Benefit** — Optionally capture the OP rule used by services that bill under the OP benefit during another LOC. Psychiatric services always use the OP benefit, even while the client is enrolled in IOP.
- **Resolved Benefit Engine** — Each service is resolved into a single benefit result (benefit category, responsibility type, patient responsibility, and accumulator behavior) before any output is written, so the staff summary and client explanation cannot contradict each other.
- **Episode Financial Activity** — Log any prior financial activity (client payments, scholarships, hardship assistance) tied to a LOC, with flags for whether each entry counts toward the deductible or OOP max.
- **Running Calculations** — Automatically computes deductible remaining, OOP remaining, and total episode activity applied to OOP.
- **Cross-LOC Warning** — Flags when the verified LOC differs from the current/most recent LOC so staff know prior activity is being carried forward.
- **Final Check** — Checklist confirming all key fields have been reviewed before submission.
- **Client-Facing Summary** — Generates a formatted plain-language summary (staff view + client explanation) that can be copied and shared.

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
3. **Enter LOC Rules** — Specify whether the deductible applies and enter copay and coinsurance (or mark them N/A). Add a contract rate when the deductible applies or coinsurance is used so per-visit amounts can be calculated. Select how services during the LOC are bundled, and add the OP rule if the client may receive OP-benefit services such as psychiatric visits.
4. **Add Episode Financial Activity** — Use the "+ Add Activity" button to log any prior financial activity for the episode.
5. **Complete the Final Check** — Check off each item to confirm everything has been reviewed.
6. **Generate Summary** — Click **Generate Snapshot** to produce a formatted staff summary and a plain-language client explanation that can be copied to the clipboard.

