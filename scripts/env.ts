// Project wallets, all derived from one mnemonic kept in .env (locally) or a repository secret (in CI).
import { existsSync, readFileSync } from "node:fs";
import { mnemonicToAccount } from "viem/accounts";
import { bytesToHex } from "viem";

const envFile = new URL("../.env", import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const mnemonic = process.env.POL_MNEMONIC;
if (!mnemonic) throw new Error("POL_MNEMONIC is not set");

export const rpc = process.env.ARKIV_ACCESS_KEY ? `https://rpc.tiramisu.db-chain.testnet.arkiv.network/${process.env.ARKIV_ACCESS_KEY}` : undefined;

/** Index map. Demo actors get their own ranges so a demo key never doubles as an infrastructure key. */
export const INDEX = { treasury: 0, publisher: 1, gasTap: 2, demoActivist: 100, demoCustodian: 200, demoForger: 300 } as const;

export function account(index: number) {
  const a = mnemonicToAccount(mnemonic!, { addressIndex: index });
  const secret = a.getHdKey().privateKey!;
  return Object.assign(a, { secret, privateKeyHex: bytesToHex(secret) });
}
