// Prints project wallet balances. With "topup <glm>", the treasury refills the publisher first.
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { account, INDEX, rpc } from "./env.js";

const reader = createPublicClient({ chain: tiramisu, transport: http(rpc) });
if (process.argv[2] === "topup") {
  const w = createWalletClient({ chain: tiramisu, transport: http(rpc), account: account(INDEX.treasury) });
  const hash = await w.sendTransaction({ to: account(INDEX.publisher).address, value: parseEther(process.argv[3] ?? "1") });
  await reader.waitForTransactionReceipt({ hash });
}
for (const [name, i] of [["treasury", INDEX.treasury], ["publisher", INDEX.publisher], ["gas tap", INDEX.gasTap]] as const) {
  console.log(name.padEnd(10), account(i).address, formatEther(await reader.getBalance({ address: account(i).address })), "GLM");
}
