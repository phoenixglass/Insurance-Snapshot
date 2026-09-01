// ─────────────────────────────────────────────────────────────────────────────
// Hardship allocation — the workbook's `HARDSHIP / SCHOLARSHIP ANALYSIS` panel.
//
// Hardship answers a different question from the self-pay scholarship. There,
// the program decides what it is covering and grants it as units of care. Here
// the client states one number — what they can afford — and the question is
// which part of the deposit that money reaches. The workbook allocates it in
// listed service order: the first service takes what it can, the next takes
// what is left, and the line where the money runs out is the one that splits.
// Everything the affordability does not reach is the hardship award.
//
// The workbook runs this against self-pay program cost. An insured client is
// not billed program cost — they are billed the deposit the plan leaves them —
// so the allocation here runs against the estimate's client responsibility.
// That is the number the client is actually being asked for, and it is the one
// hardship has to cover.
//
// Per-line responsibility is real, not apportioned guesswork: the deductible is
// consumed in the same listed order the estimator already uses, and coinsurance
// is charged on what the deductible left of each line. What is genuinely
// block-level — a copay, an admission fee, the out-of-pocket maximum — cannot
// belong to one line, so it scales the block's lines together. When nothing
// block-level applies, the scale factor is 1 and each line carries exactly what
// it costs the client.
// ─────────────────────────────────────────────────────────────────────────────

import { toNumber } from './estimate.js'

export const HARDSHIP_OFF = 'No'
export const HARDSHIP_ON = 'Yes'

// The previous balance is money already owed rather than care being priced, so
// it is allocated last: what the client can afford covers this admission first.
export const PREVIOUS_BALANCE_ROW = 'Previous outstanding balance'

const clampAtZero = (n) => (n > 0 ? n : 0)

// Scale a block's per-line basis so the lines sum to what the client is
// actually charged for that block. The basis is deductible plus coinsurance,
// which is what a line costs a client before any block-level rule; the deposit
// is that after the copay, the admission fee and the out-of-pocket cap. When a
// block has a deposit but no basis to spread it over — an admission fee on a
// stay the deductible was already exhausted for — the allowed cost stands in,
// so the money still lands on the lines that generated it.
function scaleToDeposit(rows, deposit) {
  const basis = rows.reduce((sum, r) => sum + r.basis, 0)
  if (basis > 0) {
    const scale = deposit / basis
    return rows.map((r) => ({ ...r, responsibility: r.basis * scale }))
  }
  const allowed = rows.reduce((sum, r) => sum + r.allowed, 0)
  if (allowed > 0) {
    return rows.map((r) => ({ ...r, responsibility: (r.allowed / allowed) * deposit }))
  }
  return rows.map((r) => ({ ...r, responsibility: 0 }))
}

// What each inpatient night line costs the client. The estimator already
// consumed the deductible across these in sequence order and charged
// coinsurance on the rest, so this reads those numbers rather than redoing them.
function inpatientRows(inpatient) {
  const rows = inpatient.lines
    .filter((l) => l.active && l.allowed > 0)
    .map((l) => ({
      key: l.key,
      label: l.label,
      code: l.code,
      block: 'inpatient',
      units: l.nights,
      unitNoun: 'nights',
      rate: l.rate,
      allowed: l.allowed,
      basis: l.deductibleApplied + l.coinsurance,
    }))
  return scaleToDeposit(rows, inpatient.deposit)
}

// The outpatient rows, in the order the estimator lists them. The estimator
// now spends the deductible level by level and records what each row carried,
// so this reads those numbers rather than re-deriving them — which is what
// keeps the allocation right when a level of care waives the deductible and
// the next one charges it.
function outpatientRows(outpatient) {
  const rows = outpatient.lines
    .filter((l) => l.active && l.allowed > 0)
    .map((l) => ({
      key: l.key,
      label: l.label,
      code: l.code,
      block: 'outpatient',
      units: l.units,
      unitNoun: 'units',
      rate: l.rate,
      allowed: l.allowed,
      basis: l.deductibleApplied + l.coinsurance,
    }))
  return scaleToDeposit(rows, outpatient.deposit)
}

// The allocation itself: each row takes what it can of what is left, and the
// row where the money runs out is the one that splits.
function allocate(rows, canAfford) {
  let pool = clampAtZero(canAfford)
  return rows.map((row) => {
    const clientPays = Math.min(row.responsibility, pool)
    pool = clampAtZero(pool - clientPays)
    const scholarship = clampAtZero(row.responsibility - clientPays)
    return {
      ...row,
      clientPays,
      scholarship,
      scholarshipPercent: row.responsibility === 0 ? 0 : scholarship / row.responsibility,
      // The award restated as care — the share of this line's nights or units
      // the program is carrying. Stated as a fraction of the line rather than
      // scholarship divided by a rate: an insured client's share of a night is
      // not one number (the deductible falls on the early nights and
      // coinsurance on the rest), so a dollars-per-night figure here would be
      // fiction, and a rate nobody charges is exactly what this app does not
      // print.
      coveredUnits: row.responsibility === 0 ? 0 : (scholarship / row.responsibility) * row.units,
      paidUnits:
        row.responsibility === 0 ? 0 : (clientPays / row.responsibility) * row.units,
      covered: scholarship === 0,
      split: clientPays > 0 && scholarship > 0,
    }
  })
}

export function computeHardship(result, form) {
  const active = form.hardship === HARDSHIP_ON
  const deposit = result.grandTotal
  const canAfford = toNumber(form.clientCanAfford)

  if (!active) {
    return {
      active: false,
      rows: [],
      deposit,
      canAfford: 0,
      clientPays: deposit,
      scholarship: 0,
      scholarshipPercent: 0,
      surplus: 0,
      coversPreviousBalance: 0,
      inpatient: { responsibility: 0, clientPays: 0, scholarship: 0 },
      outpatient: { responsibility: 0, clientPays: 0, scholarship: 0 },
    }
  }

  const rows = [
    ...inpatientRows(result.inpatient),
    ...outpatientRows(result.outpatient),
  ]
  if (result.previousBalance > 0) {
    rows.push({
      key: 'previousBalance',
      label: PREVIOUS_BALANCE_ROW,
      code: null,
      block: 'balance',
      units: 0,
      unitNoun: null,
      rate: null,
      allowed: result.previousBalance,
      basis: result.previousBalance,
      responsibility: result.previousBalance,
    })
  }

  const allocated = allocate(rows, canAfford)
  const clientPays = allocated.reduce((sum, r) => sum + r.clientPays, 0)
  const scholarship = allocated.reduce((sum, r) => sum + r.scholarship, 0)
  const balanceRow = allocated.find((r) => r.key === 'previousBalance')

  // The split per block, for the quote: a note that says the client pays
  // $6,000 has to say which part of the care that money reached.
  const byBlock = (block) => {
    const rows_ = allocated.filter((r) => r.block === block)
    return {
      responsibility: rows_.reduce((sum, r) => sum + r.responsibility, 0),
      clientPays: rows_.reduce((sum, r) => sum + r.clientPays, 0),
      scholarship: rows_.reduce((sum, r) => sum + r.scholarship, 0),
    }
  }

  return {
    active: true,
    rows: allocated,
    deposit,
    canAfford,
    clientPays,
    scholarship,
    scholarshipPercent: deposit === 0 ? 0 : scholarship / deposit,
    // Affordability beyond the deposit is not a credit against anything — it is
    // simply more than this estimate asks for, and the panel says so.
    surplus: clampAtZero(canAfford - deposit),
    // Forgiving an old balance is a different decision from covering this
    // admission, so it is reported on its own rather than folded into the total.
    coversPreviousBalance: balanceRow ? balanceRow.scholarship : 0,
    inpatient: byBlock('inpatient'),
    outpatient: byBlock('outpatient'),
  }
}

export function hardshipBlockers(form) {
  const blockers = []
  if (form.hardship === HARDSHIP_ON && toNumber(form.clientCanAfford, -1) < 0) {
    blockers.push('Enter what the client can afford')
  }
  return blockers
}
