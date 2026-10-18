// Bundles reader.ts into one self-contained HTML file: no network fetch except to the Arkiv endpoint.
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
const r = await build({ entryPoints: [new URL("./reader.ts", import.meta.url).pathname], bundle: true, minify: true, format: "iife", platform: "browser", target: "es2022", write: false });
const js = r.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Proof of Life · one-file reader</title>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 18px;color:#1d1d1f;background:#fff}input{width:100%;padding:10px;margin:4px 0 12px;border:1px solid #ccc;border-radius:10px;font:14px ui-monospace,monospace}button{padding:10px 20px;border:0;border-radius:99px;background:#1d1d1f;color:#fff;font-weight:600;cursor:pointer}pre{white-space:pre-wrap;background:#f5f5f7;padding:12px;border-radius:10px;font-size:13px}small{color:#6e6e73}</style></head><body>
<h1>Proof of Life · one-file reader</h1><p><small>Save this file anywhere. It opens a released vault straight from Arkiv, with no website, server or install. It never writes anything.</small></p>
<label>Vault id<input id="vault" placeholder="0x…"></label><label>Creator address<input id="creator" placeholder="0x…"></label><label>Arkiv endpoint (optional)<input id="rpc" placeholder="https://rpc.tiramisu.db-chain.testnet.arkiv.network"></label>
<button id="go">Open</button><div id="out" style="margin-top:20px"></div><script>${js}</script></body></html>`;
writeFileSync(new URL("../reader.html", import.meta.url), html);
writeFileSync(new URL("../web/public/reader.html", import.meta.url), html);
console.log(`reader.html: ${(html.length / 1024).toFixed(0)} KB`);
