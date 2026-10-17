// Reproducible probes behind arkiv/friction.md. Each prints expected vs actual.
//   npx tsx scripts/probe.ts sizes | ws | budget
import { createWalletClient, http, parseEther } from "viem";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { ExpirationTime } from "@arkiv-network/sdk";
import { str } from "@arkiv-network/sdk/attr";
import { publicClient, socketClient, walletClient, randomBytes } from "@proof-of-life/core";
import { account, INDEX, rpc } from "./env.js";

const reader = publicClient({ rpc });
const mode = process.argv[2];
const actor = account(950_000 + (Date.now() % 1000));
const publisher = createWalletClient({ chain: tiramisu, transport: http(rpc), account: account(INDEX.publisher) });
const fund = async () => reader.waitForTransactionReceipt({ hash: await publisher.sendTransaction({ to: actor.address, value: parseEther("0.2") }) });
const wallet = walletClient(actor, { rpc });
const short = (e: unknown) => String((e as Error).message).split("\n").filter(Boolean).slice(0, 2).join(" | ").slice(0, 200);
const create = (bytes: number) => ({ payload: randomBytes(bytes), contentType: "application/octet-stream", attributes: { project: str("pol-probe") }, expires: ExpirationTime.fromHours(2) });

if (mode === "sizes") {
  await fund();
  for (const kib of [96, 120, 127, 128, 129]) {
    try {
      const r = await wallet.createEntity(create(kib * 1024));
      console.log(`single ${kib} KiB: ok ${r.txHash}`);
    } catch (e) {
      console.log(`single ${kib} KiB: FAIL ${short(e)}`);
    }
  }
  for (const [n, kib] of [[2, 48], [2, 64], [2, 80], [3, 48], [2, 96]] as const) {
    try {
      const r = await wallet.executeBatch({ creates: Array.from({ length: n }, () => create(kib * 1024)) });
      console.log(`batch ${n}x${kib} KiB (${n * kib} KiB): ok ${r.txHash}`);
    } catch (e) {
      console.log(`batch ${n}x${kib} KiB (${n * kib} KiB): FAIL ${short(e)}`);
    }
  }
}

if (mode === "ws") {
  await fund();
  const got: string[] = [];
  const ws = socketClient({ ws: rpc?.replace("https://", "wss://") });
  const unwatch = ws.watchEntityEvents({
    onEntityCreated: (e) => e.owner.toLowerCase() === actor.address.toLowerCase() && got.push(`created ${e.blockNumber}`),
    onExpiryExtended: (e) => e.owner.toLowerCase() === actor.address.toLowerCase() && got.push(`extended ${e.blockNumber}`),
    onEntityDeleted: (e) => e.owner.toLowerCase() === actor.address.toLowerCase() && got.push(`deleted ${e.blockNumber}`),
    onError: (e) => got.push(`error ${short(e)}`),
  });
  const t0 = Date.now();
  const c = await wallet.createEntity({ ...create(16), expires: ExpirationTime.fromSeconds(20) });
  await wallet.extendEntity({ entityKey: c.entityKey, expires: ExpirationTime.fromSeconds(40) });
  const d = await wallet.createEntity({ ...create(16), expires: ExpirationTime.fromSeconds(20) });
  await wallet.deleteEntity({ entityKey: d.entityKey });
  await new Promise((r) => setTimeout(r, 60_000)); // c expires inside this window
  unwatch();
  console.log(`events over WebSocket in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${JSON.stringify(got)}`);
  console.log(`expected: created x2, extended x1, deleted x1, and no event for c expiring (documented)`);
  process.exit(0);
}

if (mode === "budget") {
  // Keyless reads until the public endpoint refuses, to measure the budget and how the refusal looks.
  const open = publicClient();
  let n = 0;
  const t0 = Date.now();
  try {
    for (; n < 400; n++) await open.query("project = str('pol-probe')", { limit: 1 });
    console.log(`400 keyless queries without refusal in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  } catch (e) {
    console.log(`keyless refusal after ${n} queries (${((Date.now() - t0) / 1000).toFixed(0)} s): ${short(e)}`);
  }
}

if (mode === "lifetime") {
  // Does a longer lifetime cost more? Same 32 KiB payload at 1, 30 and 365 days.
  await fund();
  for (const days of [1, 30, 365]) {
    const r = await wallet.createEntity({ ...create(32 * 1024), expires: ExpirationTime.fromDays(days) });
    const rc = await reader.waitForTransactionReceipt({ hash: r.txHash });
    console.log(`32 KiB for ${days} day(s): gas ${rc.gasUsed}, ${Number(rc.gasUsed * rc.effectiveGasPrice) / 1e18} GLM  ${r.txHash}`);
  }
}

if (mode === "unfunded") {
  // What does a write from a wallet with 0 GLM say?
  const empty = walletClient(account(960_000 + (Date.now() % 1000)), { rpc });
  try {
    await empty.createEntity(create(16));
  } catch (e) {
    console.log(`unfunded write: ${short(e)}`);
  }
}
