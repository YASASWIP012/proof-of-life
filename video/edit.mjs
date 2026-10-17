// Turns out/raw.webm + out/marks.json into the final demo: one narration clip per scene, each video scene
// re-timed to its narration, then joined into out/proof-of-life-demo.mp4.
// Voice: ElevenLabs when ELEVENLABS_API_KEY is in ../.env, otherwise the macOS voice "Rishi" as a stand-in.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const OUT = new URL("./out/", import.meta.url).pathname;
const env = existsSync(new URL("../.env", import.meta.url)) ? readFileSync(new URL("../.env", import.meta.url), "utf8") : "";
const ELEVEN = process.env.ELEVENLABS_API_KEY ?? env.match(/^ELEVENLABS_API_KEY=(.+)$/m)?.[1]?.trim();
const VOICE = process.env.ELEVENLABS_VOICE ?? "pNInz6obpgDQGcFmaJgB";

const LINES = {
  problem: "Since 2005, at least 107 people in India have been killed for using the Right to Information Act. When they are silenced, their evidence usually goes with them. Some families burned the documents out of fear.",
  idea: "Proof of Life turns that around. You seal your documents and check in on a rhythm you choose. If you stop, the people you trust can open them. Here a year passes in a minute. Stop checking in, and the vault releases.",
  drill: "This drill does it for real on Arkiv's testnet. My browser makes an activist and three custodians, encrypts a synthetic RTI reply, and writes it to Arkiv. Every encrypted piece is read only, and handed to an address nobody holds, in the same transaction. Nobody can delete it, me included.",
  checkin: "The heartbeat is an Arkiv entity that only the activist can extend. I check in once.",
  lapse: "Then I stop. Arkiv drops the heartbeat at its deadline. A forger posts a fake piece, and it is ignored, because its on-chain creator is wrong. Custodian two is unreachable, but two of three is enough.",
  public: "The public page rebuilds the key from the pieces on Arkiv, and decrypts. Every file matches the hash sealed when it was created.",
  cli: "The same thing works from any terminal, with no website involved.",
  safety: "If someone forces the activist to check in, a duress passphrase makes a check-in that looks identical on the chain. Only the custodians can read that it means: release now.",
  close: "This vault stops at noon on the twenty-first of October, during judging, and its custodians will release it on schedule. Proof of Life. If my heartbeat stops, the truth comes out.",
};

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
const duration = (f) => Number(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).trim());

async function voice(name, text) {
  const mp3 = `${OUT}vo-${name}.mp3`;
  if (existsSync(mp3) && !process.env.REVOICE) return mp3;
  if (ELEVEN) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}`, {
      method: "POST",
      headers: { "xi-api-key": ELEVEN, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.55, similarity_boost: 0.75 } }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
    writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
  } else {
    sh("say", ["-v", "Rishi", "-r", "172", "-o", `${OUT}vo-${name}.aiff`, text]);
    sh("ffmpeg", ["-y", "-loglevel", "error", "-i", `${OUT}vo-${name}.aiff`, "-ar", "44100", mp3]);
  }
  return mp3;
}

const marks = JSON.parse(readFileSync(`${OUT}marks.json`, "utf8"));
const parts = [];
for (const m of marks) {
  const vo = await voice(m.name, LINES[m.name]);
  const spoken = duration(vo) + 0.6;
  const seg = m.end - m.start;
  const speed = seg / spoken; // >1 speeds the footage up to fit the line, <1 slows it
  const out = `${OUT}part-${m.name}.mp4`;
  sh("ffmpeg", [
    "-y", "-loglevel", "error", "-ss", String(m.start), "-t", String(seg), "-i", `${OUT}raw.webm`, "-i", vo,
    "-filter_complex", `[0:v]setpts=PTS/${speed.toFixed(4)},fps=30,scale=1440:900,format=yuv420p[v];[1:a]apad=pad_dur=0.6[a]`,
    "-map", "[v]", "-map", "[a]", "-t", spoken.toFixed(2), "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "160k", out,
  ]);
  parts.push(out);
  console.log(`${m.name}: footage ${seg.toFixed(1)}s -> ${spoken.toFixed(1)}s (x${speed.toFixed(2)})`);
}
writeFileSync(`${OUT}parts.txt`, parts.map((p) => `file '${p}'`).join("\n"));
sh("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", `${OUT}parts.txt`, "-c", "copy", `${OUT}proof-of-life-demo.mp4`]);
console.log(`done: ${OUT}proof-of-life-demo.mp4, ${duration(`${OUT}proof-of-life-demo.mp4`).toFixed(1)} s, voice ${ELEVEN ? "ElevenLabs" : "macOS Rishi"}`);
