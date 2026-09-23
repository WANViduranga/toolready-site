/* ============================================
   RATES.JS
   This is the single file to edit whenever a government rate changes
   (tax brackets, EPF/ETF percentages, etc). Every calculator that
   needs one of these numbers reads it from here - so you never have
   to hunt through calculator code to update a rate.

   IMPORTANT: whenever you update a number below, also update its
   "lastVerified" date and "source" note. The calculator pages show
   these to visitors as a trust signal ("Rates last checked: ...").
   ============================================ */

const RATES = {

  // --- Sri Lanka APIT (income tax) ---
  // Source: Inland Revenue Department, Tax Table No. 01, Y/A 2025/26
  // (effective 1 April 2025). Verify against ird.gov.lk before relying
  // on this for real filings - always check for a new IRD notice first.
  apit: {
    lastVerified: "2026-09-15",
    source: "IRD Tax Table No. 01, Y/A 2025/26",
    personalReliefAnnual: 1800000,     // LKR, tax-free threshold per year
    brackets: [
      { upTo: 1000000, rate: 0.06 },   // first 1,000,000 of taxable income
      { upTo: 1500000, rate: 0.18 },   // next 500,000
      { upTo: 2000000, rate: 0.24 },   // next 500,000
      { upTo: 2500000, rate: 0.30 },   // next 500,000
      { upTo: Infinity, rate: 0.36 }   // everything above
    ]
  },

  // --- EPF / ETF ---
  // These have been stable for a long time and rarely change.
  epf: {
    lastVerified: "2026-09-15",
    source: "EPF Act - standard statutory rates",
    employeeRate: 0.08,   // deducted from employee's salary
    employerRate: 0.12    // paid by employer on top, not deducted from salary
  },
  etf: {
    lastVerified: "2026-09-15",
    source: "ETF Act - standard statutory rate",
    employerRate: 0.03    // employer-only, no employee deduction
  },

  // --- Vehicle import duty ---
  // ⚠ ONE RATE STILL NEEDS YOUR VERIFICATION, PLUS ONE MISSING COMPONENT.
  // PAL, SSCL, VAT and the excise tiers below are confirmed consistently
  // across multiple current sources (checked 2026-09-19). Customs Duty
  // itself is NOT settled - sources disagree between a flat 100% and a
  // 30% base + temporary 50% surcharge (~45% effective) tied to a 2026
  // gazette that may have since expired. Confirm the current figure with
  // Sri Lanka Customs or a clearing agent, then update customsDutyRate
  // below. Separately, a Luxury Tax layer (roughly 5-6M LKR CIF threshold,
  // varies by fuel type) is not modelled here at all yet - add it once
  // you've confirmed the current threshold and rate.
  vehicleDuty: {
    lastVerified: "2026-09-19 (customs duty rate + luxury tax still unconfirmed - see note above)",
    source: "PAL/SSCL/VAT/Excise cross-checked across current sources; Customs Duty rate disputed - confirm before publishing",
    customsDutyRate: 1.00,      // ⚠ DISPUTED - could be as low as ~0.45 - verify with Sri Lanka Customs
    palRate: 0.075,             // 7.5% - confirmed
    ssclRate: 0.025,            // 2.5% - confirmed
    vatRate: 0.18,              // 18% - confirmed
    exciseByCC: [                // confirmed - petrol/diesel, tiered by engine size
      { upToCC: 1000, rate: 0.00 },
      { upToCC: 1500, rate: 0.50 },
      { upToCC: 2000, rate: 0.65 },
      { upToCC: 3000, rate: 0.75 },
      { upToCC: Infinity, rate: 1.00 }
    ],
    evExciseRate: 0.00           // confirmed - EVs pay 0% excise
    // luxuryTax: not yet modelled - see note above
  },

  // --- Gratuity (Sri Lanka) ---
  // Set by law (Payment of Gratuity Act No. 12 of 1983), not a rate that
  // moves with the economy - so this needs far less maintenance than the
  // tax/duty entries above. Still worth checking occasionally in case of
  // a future amendment.
  gratuity: {
    lastVerified: "2026-09-22",
    source: "Payment of Gratuity Act No. 12 of 1983",
    minimumYearsOfService: 5,      // must complete 5+ years to qualify
    monthsSalaryPerYear: 0.5       // half a month's salary per year of service
  }
};
