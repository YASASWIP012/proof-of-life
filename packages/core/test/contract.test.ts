import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dataContract } from "../src/index.js";

describe("arkiv/contract.schema.json", () => {
  it("matches the schemas the code validates with (regenerate with npx tsx scripts/contract.ts)", () => {
    const onDisk = JSON.parse(readFileSync(new URL("../../../arkiv/contract.schema.json", import.meta.url), "utf8"));
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(dataContract())));
  });
  it("covers every entity the app writes", () => {
    expect(Object.keys(dataContract()["x-entities"]).sort()).toEqual(["ack", "beat", "chunk", "envelope", "heartbeat", "release", "rti", "vault"]);
  });
});
