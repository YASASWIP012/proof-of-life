// Build on Proof of Life without asking us: list released evidence and check every piece the way our app does,
// using only the Arkiv SDK (plus viem, which it builds on) and Node's crypto. Rules: arkiv/contract.schema.json.
//   npm install && node examples/list-released.mjs        (ARKIV_RPC=<your endpoint> to use your own node)
import { createHash } from "node:crypto";
import { createPublicClient } from "@arkiv-network/sdk";
import { bytes32, str } from "@arkiv-network/sdk/attr";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { eq, or } from "@arkiv-network/sdk/query";
import { http } from "viem";

const client = createPublicClient({ chain: tiramisu, transport: http(process.env.ARKIV_RPC ?? "https://rpc.tiramisu.db-chain.testnet.arkiv.network") });
const sha256 = (...parts) => createHash("sha256").update(Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p) : p)))).digest();
const hex = (h) => Buffer.from(h.slice(2), "hex");
const at = (row, name) => row.attributes[name]?.value;

// Every release carries the project tag, its slot and its vault's creator, even for a vault that was unlisted.
const releases = (await client.select({ creator: true, attributes: true, payload: true }).where(eq("project", str("proof-of-life")), eq("type", str("release"))).limit(200).fetch()).entities;
const vaults = new Map();
for (const r of releases) {
  const id = `${at(r, "vault_id")}:${at(r, "vault_creator")}`;
  vaults.set(id, [...(vaults.get(id) ?? []), r]);
}

for (const [id, rows] of vaults) {
  const [vaultId, creator] = id.split(":");
  // The manifest: written by the vault's creator, with a plain or (unlisted) hashed type.
  const hidden = `x${sha256("proof-of-life/kind/v1", hex(vaultId), "vault").toString("hex").slice(0, 24)}`;
  const page = await client.select({ payload: true }).where(eq("vault_id", bytes32(vaultId)), or(eq("type", str("vault")), eq("type", str(hidden)))).createdBy(creator).limit(1).fetch();
  const manifest = JSON.parse(new TextDecoder().decode(page.entities[0].payload));
  const seen = new Set();
  for (const r of rows) {
    const slot = Number(at(r, "slot"));
    const body = JSON.parse(new TextDecoder().decode(r.payload));
    const custodian = manifest.custodians.find((c) => c.slot === slot)?.address.toLowerCase();
    const share = hex(body.share);
    // A piece counts only from the slot's custodian, once per slot, with a share matching the sealed commitment.
    const ok = custodian === r.creator.toLowerCase() && !seen.has(slot) && (body.sealed_to_newsroom || `0x${sha256("proof-of-life/share/v1", hex(vaultId), share).toString("hex")}` === manifest.commitments[slot - 1]);
    if (ok) seen.add(slot);
    console.log(`${vaultId.slice(0, 10)}… slot ${slot} from ${r.creator.slice(0, 8)}…  ${ok ? "valid" : "ignored"}`);
  }
  console.log(`  → ${seen.size} of ${manifest.k} needed: ${seen.size >= manifest.k ? "anyone can open it" : "still sealed"}\n`);
}
