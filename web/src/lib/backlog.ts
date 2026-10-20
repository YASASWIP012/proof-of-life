// Second-appeal backlog by information commission, from Satark Nagrik Sangathan's "Report Card on the Performance of
// Information Commissions in India, 2024-25" (press release, 9 October 2025). Only figures stated in that release are
// here; a commission with no entry gets the national picture instead of a guessed number.
export const BACKLOG_SOURCE = "https://www.snsindia.org/wp-content/uploads/2025/10/Press-Release-2025.pdf";
export const BACKLOG_PENDING = "4,13,972";

export type Commission = {
  id: string;
  name: string;
  /** Estimated wait to dispose of a matter filed on 1 July 2025. */
  wait?: { y: number; m: number };
  /** Had no commissioners as of 7 October 2025. */
  defunct?: boolean;
  /** Working without a Chief Information Commissioner as of October 2025. */
  noChief?: boolean;
  /** Named as working with fewer commissioners than the law allows. */
  reduced?: boolean;
};

export const COMMISSIONS: Commission[] = [
  { id: "cic", name: "Central Information Commission (central government offices)", noChief: true, reduced: true },
  { id: "ap", name: "Andhra Pradesh", noChief: true },
  { id: "ar", name: "Arunachal Pradesh" },
  { id: "as", name: "Assam" },
  { id: "br", name: "Bihar", reduced: true },
  { id: "cg", name: "Chhattisgarh", wait: { y: 11, m: 0 }, noChief: true, reduced: true },
  { id: "ga", name: "Goa" },
  { id: "gj", name: "Gujarat" },
  { id: "hr", name: "Haryana" },
  { id: "hp", name: "Himachal Pradesh", defunct: true },
  { id: "jh", name: "Jharkhand", defunct: true },
  { id: "ka", name: "Karnataka", reduced: true },
  { id: "kl", name: "Kerala" },
  { id: "mp", name: "Madhya Pradesh", wait: { y: 7, m: 0 }, reduced: true },
  { id: "mh", name: "Maharashtra", reduced: true },
  { id: "mn", name: "Manipur" },
  { id: "ml", name: "Meghalaya" },
  { id: "mz", name: "Mizoram" },
  { id: "nl", name: "Nagaland" },
  { id: "od", name: "Odisha" },
  { id: "pb", name: "Punjab", wait: { y: 7, m: 0 } },
  { id: "rj", name: "Rajasthan" },
  { id: "sk", name: "Sikkim" },
  { id: "tn", name: "Tamil Nadu", reduced: true },
  { id: "tg", name: "Telangana", wait: { y: 29, m: 2 } },
  { id: "tr", name: "Tripura", wait: { y: 23, m: 0 } },
  { id: "up", name: "Uttar Pradesh" },
  { id: "uk", name: "Uttarakhand" },
  { id: "wb", name: "West Bengal" },
];
