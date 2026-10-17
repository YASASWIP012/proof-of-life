// Creates the project's test mnemonic in .env (never printed) and lists the addresses it derives.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { english, generateMnemonic, mnemonicToAccount } from "viem/accounts";

const ENV = new URL("../.env", import.meta.url);
let env = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
if (!/^DHADKAN_MNEMONIC=/m.test(env)) {
  env += `DHADKAN_MNEMONIC="${generateMnemonic(english)}"\n`;
  writeFileSync(ENV, env, { mode: 0o600 });
}
const mnemonic = env.match(/^DHADKAN_MNEMONIC="(.+)"$/m)![1];
const roles = ["treasury", "publisher", "gas-tap"];
roles.forEach((role, i) => console.log(role.padEnd(10), mnemonicToAccount(mnemonic, { addressIndex: i }).address));
