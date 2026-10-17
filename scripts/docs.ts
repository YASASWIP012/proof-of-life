// Synthetic documents for the demo vaults. Every person, place, amount and reference number is invented.
import { utf8, type VaultFile } from "@proof-of-life/core";

const header = "SYNTHETIC TEST DOCUMENT. NOT A REAL RECORD. ALL NAMES, PLACES AND FIGURES ARE INVENTED.\n\n";

export const DEMO_DOCS: Record<string, { title: string; note: string; files: VaultFile[] }> = {
  road: {
    title: "Village A-17: 4.2 km of road paid for, 1.1 km built (synthetic)",
    note: "If you are reading this, I could not check in. The measurement book page is the one that matters.",
    files: [
      { name: "rti-reply-rural-works-SYNTHETIC.txt", type: "text/plain", bytes: utf8(`${header}Office of the Public Information Officer, Rural Works Division, Fictional District\nRef: SYN/PIO/2291/2026\n\n1. Work order WO-2291 sanctioned 4.2 km of road for Village A-17, Rs 1,84,00,000.\n2. Measurement book records 4.2 km completed on 12-03-2025.\n3. Completion certificate signed by the Assistant Engineer (designation only).\n`) },
      { name: "field-survey-SYNTHETIC.csv", type: "text/csv", bytes: utf8(`segment,start_km,end_km,status\nS1,0.0,0.6,built\nS2,0.6,1.1,built\nS3,1.1,4.2,not found on ground\n`) },
    ],
  },
  ration: {
    title: "Fair price shop stock register vs distribution (synthetic)",
    note: "Two registers, one shop, 31 quintals apart.",
    files: [
      { name: "stock-register-extract-SYNTHETIC.txt", type: "text/plain", bytes: utf8(`${header}Shop SYN-FPS-118, month 08/2026\nReceived: 212 quintals wheat\nDistributed per ePoS: 181 quintals\nClosing balance declared: 0\n`) },
    ],
  },
  hospital: {
    title: "District hospital equipment purchase (synthetic)",
    note: "Purchased twice, delivered once.",
    files: [
      { name: "purchase-orders-SYNTHETIC.txt", type: "text/plain", bytes: utf8(`${header}PO SYN-DH-77, 2 ventilators, Rs 38,00,000, delivered 1\nPO SYN-DH-81, 2 ventilators, Rs 38,00,000, delivered 0\n`) },
    ],
  },
};
