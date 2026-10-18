// Records the demo from the live site. Every scene is real: the drill writes to Arkiv while the camera rolls.
// Output: out/raw.webm plus out/marks.json (scene start/end in seconds), which edit.mjs cuts to the narration.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync } from "node:fs";

const SITE = process.env.SITE ?? "https://proof-of-life-khaki.vercel.app";
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const demo = JSON.parse(readFileSync(new URL("../scripts/demo-vaults.json", import.meta.url), "utf8"));
const vp = (v) => `${SITE}/#/v/${v.vaultId}/${v.creator}`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
const t0 = Date.now();
const marks = [];
const mark = (name) => {
  const now = (Date.now() - t0) / 1000;
  if (marks.length) marks[marks.length - 1].end = now;
  marks.push({ name, start: now });
  console.log(`${now.toFixed(1)}s ${name}`);
};
const wait = (ms) => page.waitForTimeout(ms);
const glide = async (to, ms = 2500) => {
  await page.evaluate(([y, d]) => new Promise((r) => {
    const from = scrollY, t = performance.now();
    const step = (n) => { const k = Math.min(1, (n - t) / d); scrollTo(0, from + (y - from) * (k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)); k < 1 ? requestAnimationFrame(step) : r(); };
    requestAnimationFrame(step);
  }), [to, ms]);
};
const yOf = (sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top + scrollY - 90, sel);

// 1. Problem: hero, then the numbers.
await page.goto(SITE, { waitUntil: "networkidle" });
await wait(2500);
mark("problem");
await wait(6000);
await glide(980, 3000);
await wait(9000);

// 2. Idea: the simulator, switched to silence.
mark("idea");
await glide(await yOf("#try"), 2500);
await wait(2500);
await page.locator(".switch").first().click();
await page.waitForFunction(() => /Released|जारी हो गया|విడుదలైంది/.test(document.querySelector("#try")?.textContent ?? ""), null, { timeout: 120000 });
await wait(2500);

// 3. The real thing: the drill on Arkiv.
mark("drill");
await page.goto(`${SITE}/#/drill`, { waitUntil: "networkidle" });
await wait(1500);
await page.getByRole("button", { name: "Start the drill" }).click();
await page.getByRole("button", { name: "Check in" }).last().waitFor({ timeout: 180000 });
await wait(4000);
mark("checkin");
await page.getByRole("button", { name: "Check in" }).last().click();
await wait(8000);
mark("lapse");
await page.getByText("The documents are out.").waitFor({ timeout: 300000 });
await wait(4000);

// 4. Anyone can read it: the public page decrypts.
mark("public");
await page.getByRole("button", { name: "Open the public vault page" }).click();
await wait(3500);
await page.getByRole("button", { name: "Open the documents" }).click();
await page.getByText("Every file matches the hash").waitFor({ timeout: 60000 });
await wait(1500);
await glide(await yOf("main .card"), 2000);
await wait(5000);

// 5. Terminal: the real CLI output, shown in a terminal frame.
mark("cli");
const rel = demo.released;
// The CLI's exit code is the vault phase (4 = released), so read stdout whatever the code is.
const runCli = (...args) => {
  try {
    return execFileSync("node", [new URL("../cli/dist/proof-of-life.mjs", import.meta.url).pathname, ...args], { encoding: "utf8" }).trimEnd();
  } catch (e) {
    return String(e.stdout ?? "").trimEnd();
  }
};
const cli = runCli("status", rel.vaultId, rel.creator);
const open = runCli("open", rel.vaultId, rel.creator, "--out", "/tmp/pol-video-open");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
// The terminal is drawn as an overlay on the live site, so the page itself never changes and later scenes navigate normally.
await page.evaluate((html) => {
  const d = document.createElement("div");
  d.id = "term-overlay";
  d.style.cssText = "position:fixed;inset:0;z-index:9999;background:linear-gradient(160deg,#2A2F5C,#16182B);display:grid;place-items:center;font-family:Inter,system-ui";
  d.innerHTML = html;
  document.body.appendChild(d);
}, `
<div style="width:1100px;border-radius:14px;overflow:hidden;box-shadow:0 40px 90px -30px rgba(0,0,0,.6)">
<div style="height:38px;background:#26262B;display:flex;align-items:center;gap:8px;padding:0 14px"><i style="width:12px;height:12px;border-radius:50%;background:#FF5F57"></i><i style="width:12px;height:12px;border-radius:50%;background:#FEBC2E"></i><i style="width:12px;height:12px;border-radius:50%;background:#28C840"></i><span style="margin-left:auto;margin-right:auto;color:#9A9AA2;font-size:13px">Terminal · no website involved</span></div>
<pre id="t" style="margin:0;background:#121318;color:#EEF0F6;font:15px/1.6 'JetBrains Mono',ui-monospace,monospace;padding:24px;min-height:520px;white-space:pre-wrap"></pre></div>`);
const lines = [`$ npx github:YASASWIP012/proof-of-life status ${rel.vaultId.slice(0, 18)}… ${rel.creator.slice(0, 10)}…`, ...cli.split("\n"), "", `$ npx github:YASASWIP012/proof-of-life open ${rel.vaultId.slice(0, 18)}… ${rel.creator.slice(0, 10)}…`, ...open.split("\n")];
for (const l of lines) {
  await page.evaluate((x) => (document.getElementById("t").textContent += x + "\n"), l);
  await wait(l.startsWith("$") ? 900 : 180);
}
await wait(3000);
await page.evaluate(() => document.getElementById("term-overlay")?.remove());

// 6. Safety: the duress passphrase and what an observer sees.
mark("safety");
// Later scenes never abort the recording: a failed step is logged and the camera keeps rolling.
const soft = async (label, fn) => {
  try {
    await fn();
  } catch (e) {
    console.log(`skipped ${label}: ${String(e.message).split("\n")[0]}`);
  }
};
await page.goto(`${SITE}/#/new`, { waitUntil: "networkidle" });
await soft("duress field", async () => {
  const label = page.getByText("Duress passphrase (optional)", { exact: true });
  await label.waitFor({ timeout: 15000 });
  await label.scrollIntoViewIfNeeded();
  await label.hover();
});
await wait(7000);
await page.goto(`${SITE}/#/`, { waitUntil: "networkidle" });
await soft("faq", async () => {
  await glide(await yOf(".faq"), 2500);
  await page.getByText("What if someone forces me to check in?", { exact: true }).click({ timeout: 15000 });
});
await wait(7000);

// 7. Close: the vault that stops during judging, then the home page.
mark("close");
await page.goto(vp(demo["lapses-oct-21"]), { waitUntil: "networkidle" });
await wait(9000);
await page.goto(SITE, { waitUntil: "networkidle" });
await wait(1000);
await glide(await page.evaluate(() => document.body.scrollHeight - innerHeight - 260), 2500);
await wait(6000);
mark("end");

await ctx.close();
await browser.close();
const vid = readdirSync(OUT).find((f) => f.endsWith(".webm") && f !== "raw.webm");
renameSync(OUT + vid, OUT + "raw.webm");
writeFileSync(OUT + "marks.json", JSON.stringify(marks.slice(0, -1), null, 2));
console.log("raw video and marks written");
