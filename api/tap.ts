// Sends a little test GLM to a fresh browser key so people can try Proof of Life without a wallet or a faucet.
import { createPublicClient, createWalletClient, http, isAddress, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { clientIp, cors, keyedRpc, limiter } from "./_lib.js";

const perIp = limiter(12, 60 * 60 * 1000);
const perAddress = limiter(3, 60 * 60 * 1000);
const GRANT = parseEther("0.06");
const ENOUGH = parseEther("0.05");

export default async function handler(req: any, res: any) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const address = String(req.body?.address ?? "");
  if (!isAddress(address)) return res.status(400).json({ error: "not an address" });
  if (!process.env.GAS_TAP_KEY) return res.status(503).json({ error: "gas tap is not configured" });
  if (!perIp(clientIp(req)) || !perAddress(address.toLowerCase())) return res.status(429).json({ error: "the gas tap is resting; try again in an hour" });

  const transport = http(keyedRpc());
  const reader = createPublicClient({ chain: tiramisu, transport });
  const have = await reader.getBalance({ address });
  if (have >= ENOUGH) return res.status(200).json({ sent: "0", balance: formatEther(have) });

  const account = privateKeyToAccount(process.env.GAS_TAP_KEY as `0x${string}`);
  const wallet = createWalletClient({ chain: tiramisu, transport, account });
  try {
    const hash = await wallet.sendTransaction({ to: address, value: GRANT - have });
    return res.status(200).json({ sent: formatEther(GRANT - have), tx: hash });
  } catch (e) {
    return res.status(502).json({ error: `tap could not send: ${String((e as Error).message).slice(0, 120)}` });
  }
}
