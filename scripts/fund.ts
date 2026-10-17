// Spreads the GLM that arrived at the treasury to the wallets that need it.
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { account, INDEX, rpc } from "./env.js";

const transport = http(rpc);
const reader = createPublicClient({ chain: tiramisu, transport });
const treasury = account(INDEX.treasury);
const wallet = createWalletClient({ chain: tiramisu, transport, account: treasury });

const plan: [string, number, string][] = [
  ["gas tap", INDEX.gasTap, process.argv[2] ?? "4"],
  ["publisher", INDEX.publisher, process.argv[3] ?? "2"],
];
console.log(`treasury ${treasury.address}: ${formatEther(await reader.getBalance({ address: treasury.address }))} GLM`);
for (const [name, idx, amount] of plan) {
  const to = account(idx).address;
  const hash = await wallet.sendTransaction({ to, value: parseEther(amount) });
  await reader.waitForTransactionReceipt({ hash });
  console.log(`${name.padEnd(10)} ${to} +${amount} GLM  ${hash}`);
}
