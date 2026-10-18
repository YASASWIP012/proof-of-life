// The data contract as a machine-readable JSON Schema, built from the same zod schemas the app validates with,
// so it cannot drift from the code. `npx tsx scripts/contract.ts` writes it to arkiv/contract.schema.json, and a
// test fails if that file and this function ever disagree.
import { z } from "zod";
import { TIRAMISU } from "./client.js";
import { RtiPayload, RtiReceipt } from "./rti.js";
import { LIFETIME, Manifest, PROJECT, ReleasePayload, SCHEMA_VERSION } from "./schema.js";

type Attr = { type: "str" | "i32" | "u64" | "bytes32" | "addr"; value?: string | number; description: string };

const kindType = (kind: string): Attr => ({
  type: "str",
  description: `"${kind}" on listed vaults; on unlisted vaults "x" + hex of the first 12 bytes of sha256("proof-of-life/kind/v1" ‖ vault_id ‖ "${kind}")`,
});
const listedOnly = {
  project: { type: "str", value: PROJECT, description: "listed vaults only (and every release)" } as Attr,
  v: { type: "i32", value: SCHEMA_VERSION, description: "schema version, listed vaults only" } as Attr,
};
const vaultId: Attr = { type: "bytes32", description: "random 32 bytes chosen in the activist's browser; links every entity of one vault" };

export function dataContract() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://github.com/YASASWIP012/proof-of-life/blob/main/arkiv/contract.schema.json",
    title: "Proof of Life data contract on Arkiv",
    description:
      "Every entity Proof of Life writes, its typed attributes, payload and lifetime, and the rules a reader applies. Build another reader, watcher or app from this without asking us. Prose version: arkiv/schema.md. Versioning: fields are only ever added, never renamed or removed; a breaking change would bump `v`.",
    "x-network": { chainId: TIRAMISU.chainId, rpc: TIRAMISU.rpc, ws: TIRAMISU.ws, sdk: "@arkiv-network/sdk 0.8.x" },
    "x-trust-rules": [
      "A heartbeat, beat, manifest, chunk or envelope counts only if its $creator is the vault's creator.",
      "A release counts only if its $creator is the custodian named for its slot in the manifest, its payload names the same slot, it is the first for that slot, and its share matches the slot's commitment: sha256(\"proof-of-life/share/v1\" ‖ vault_id ‖ share).",
      "An ack counts only if its $creator is the custodian named for its slot.",
      "The vault's phase follows from the heartbeat's $expiresAt and the number of valid releases; k valid releases open it.",
    ],
    "x-entities": {
      vault: {
        writer: "activist",
        attributes: { ...listedOnly, type: kindType("vault"), vault_id: vaultId, k: { type: "i32", description: "listed only" }, n: { type: "i32", description: "listed only" }, mode: { type: "str", description: "public | newsroom, listed only" }, interval_s: { type: "u64", description: "listed only" }, grace_s: { type: "u64", description: "listed only" }, chunks: { type: "i32", description: "listed only" }, sealed_at_ms: { type: "u64", description: "listed only" } },
        payload: { contentType: "application/json", schema: { $ref: "#/$defs/Manifest" } },
        flags: { readonly: true, permissionlessExtension: true },
        owner: "0x…dEaD (listed) or the vault's own seal address (unlisted), set in the creating batch",
        lifetime: `vault term: default ${LIFETIME.defaultVaultDays} days, minimum ${LIFETIME.minVaultDays}; anyone may extend`,
      },
      chunk: {
        writer: "activist",
        attributes: { ...listedOnly, type: kindType("chunk"), vault_id: vaultId, idx: { type: "i32", description: "listed only; unlisted chunks are ordered by matching their hash to manifest.chunks.hashes" } },
        payload: { contentType: "application/octet-stream", description: "up to 96 KiB of AES-256-GCM ciphertext (12-byte nonce in front); the bundle is padded to a 64 KiB bucket before encryption" },
        flags: { readonly: true, permissionlessExtension: true },
        owner: "same as the vault",
        lifetime: "vault term",
      },
      envelope: {
        writer: "activist",
        attributes: { ...listedOnly, type: kindType("envelope"), vault_id: vaultId, slot: { type: "i32", description: "listed only" }, custodian: { type: "addr", description: "the custodian's one-time key, so a custodian can find its envelopes" } },
        payload: { contentType: "application/octet-stream", description: "one key share (plus the ok and duress tokens), ECIES-encrypted to the custodian's key" },
        flags: { readonly: true, permissionlessExtension: true },
        owner: "same as the vault",
        lifetime: "vault term",
      },
      heartbeat: {
        writer: "activist",
        attributes: { ...listedOnly, type: kindType("heartbeat"), vault_id: vaultId, interval_s: { type: "u64", description: "listed only" }, grace_s: { type: "u64", description: "listed only" } },
        payload: { contentType: "application/octet-stream", description: "empty" },
        flags: { readonly: true, permissionlessExtension: false },
        owner: "the activist, so only its key can extend it",
        lifetime: "interval_s + grace_s, reset by every check-in (extendEntity); when it expires the vault has lapsed",
      },
      beat: {
        writer: "activist",
        attributes: { ...listedOnly, type: kindType("beat"), vault_id: vaultId },
        payload: { contentType: "application/octet-stream", description: "the check-in's 16-byte token encrypted to each custodian, n × 77 bytes; only a custodian can tell ok from duress" },
        flags: { readonly: true, permissionlessExtension: false },
        owner: "the activist",
        lifetime: "interval_s + grace_s",
      },
      ack: {
        writer: "custodian",
        attributes: { ...listedOnly, type: kindType("ack"), vault_id: vaultId, slot: { type: "i32", description: "listed only" } },
        payload: { contentType: "application/octet-stream", description: "empty" },
        flags: { readonly: true, permissionlessExtension: false },
        owner: "the custodian",
        lifetime: `${LIFETIME.ackDays} days, renewed by the custodian's watcher`,
      },
      release: {
        writer: "custodian",
        attributes: { project: { type: "str", value: PROJECT, description: "on every release, listed vault or not" }, v: listedOnly.v, type: { type: "str", value: "release", description: "always plain, so released evidence is findable" }, vault_id: vaultId, slot: { type: "i32", description: "the custodian's slot" }, vault_creator: { type: "addr", description: "the vault's creator" } },
        payload: { contentType: "application/json", schema: { $ref: "#/$defs/ReleasePayload" } },
        flags: { readonly: true, permissionlessExtension: true },
        owner: "0x…dEaD, set in the creating batch",
        lifetime: "vault term; anyone may extend",
      },
      rti: {
        writer: "a one-time key in the filer's browser",
        attributes: { type: { type: "str", description: 'x + hex of the first 12 bytes of sha256("proof-of-life/rti-tag/v2" ‖ commitment)' } },
        payload: { contentType: "application/json", schema: { $ref: "#/$defs/RtiPayload" } },
        flags: { readonly: true, permissionlessExtension: false },
        owner: 'the record\'s own seal address: last 20 bytes of sha256("proof-of-life/rti-seal/v2" ‖ commitment)',
        lifetime: "until due_block + 165 days: the First Appeal (s.19(1)), its decision (s.19(6)) and the second appeal (s.19(3))",
      },
    },
    $defs: {
      Manifest: z.toJSONSchema(Manifest, { target: "draft-2020-12" }),
      ReleasePayload: z.toJSONSchema(ReleasePayload, { target: "draft-2020-12" }),
      RtiPayload: z.toJSONSchema(RtiPayload, { target: "draft-2020-12" }),
      RtiReceipt: z.toJSONSchema(RtiReceipt, { target: "draft-2020-12" }),
    },
  };
}
