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
  // ⚠ PLACEHOLDER RATES - DO NOT PUBLISH WITHOUT VERIFYING.
  // Sri Lanka vehicle import duty is genuinely complex and changes
  // often (multiple components: Customs Duty, Excise/SPD, PAL, SSCL,
  // Surcharge, Luxury Tax, VAT - and the exact percentages are disputed
  // even across existing tax-calculator sites). Before this calculator
  // goes live, verify every number below against the current Sri Lanka
  // Customs Gazette at customs.gov.lk, or an official notice.
  vehicleDuty: {
    lastVerified: "NEEDS VERIFICATION - placeholder values only",
    source: "PLACEHOLDER - confirm with Sri Lanka Customs before publishing",
    customsDutyRate: 1.00,      // 100% - verify
    palRate: 0.075,             // 7.5% - verify
    ssclRate: 0.025,            // 2.5% - verify
    vatRate: 0.18,              // 18% - verify
    exciseByCC: [               // excise duty tier by engine size - verify all
      { upToCC: 1000, rate: 0.00 },
      { upToCC: 1500, rate: 0.50 },
      { upToCC: 2000, rate: 0.65 },
      { upToCC: 3000, rate: 0.75 },
      { upToCC: Infinity, rate: 1.00 }
    ],
    evExciseRate: 0.00           // EVs - verify current EV excise treatment
  }
};
