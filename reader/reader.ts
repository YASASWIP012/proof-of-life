// The one-file reader: open and decrypt a released vault with nothing but this file and an Arkiv endpoint.
import { loadCiphertext, loadVault, publicClient, unsealVault } from "@proof-of-life/core";
import type { Hex } from "viem";

const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const out = $("out");
const say = (html: string) => (out.innerHTML = html);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function open() {
  const vaultId = $("vault").value.trim() as Hex;
  const creator = $("creator").value.trim() as Hex;
  const rpc = $("rpc").value.trim() || undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(vaultId) || !/^0x[0-9a-fA-F]{40}$/.test(creator)) return say("Paste a vault id (0x + 64 hex) and its creator address (0x + 40 hex).");
  say("Reading from Arkiv…");
  try {
    const client = publicClient({ rpc });
    const v = await loadVault(client, vaultId, creator);
    const shares = v.releases.filter((r) => r.valid && r.share).map((r) => r.share!);
    const head = `<p>Phase: <b>${v.status.phase}</b> · ${shares.length} of ${v.manifest.k} valid pieces public · ${v.rejected.length} forged or invalid entities ignored</p>`;
    if (shares.length < v.manifest.k) return say(head + "<p>Not enough pieces are public yet, so the documents stay sealed.</p>");
    const { ciphertext } = await loadCiphertext(client, v);
    const { bundle, files, verified } = unsealVault(v.vaultId, ciphertext, shares);
    const list = files.map((f) => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(f.bytes)], { type: f.type }));
      const preview = f.type.startsWith("text/") ? `<pre>${esc(new TextDecoder().decode(f.bytes))}</pre>` : "";
      return `<li><a href="${url}" download="${esc(f.name)}">${esc(f.name)}</a> (${f.bytes.length} bytes)${preview}</li>`;
    }).join("");
    say(`${head}<h2>${esc(bundle.title)}</h2><p>${esc(bundle.note)}</p><p>${verified ? "Every file matches the hash sealed when the vault was created." : "WARNING: some files do not match their sealed hash."}</p><ul>${list}</ul>`);
  } catch (e) {
    say(`Could not open this vault: ${esc(String((e as Error).message))}`);
  }
}
document.getElementById("go")!.addEventListener("click", open);
const q = new URLSearchParams(location.hash.slice(1));
if (q.get("v")) ($("vault").value = q.get("v")!), ($("creator").value = q.get("c") ?? ""), open();
