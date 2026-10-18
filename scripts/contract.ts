// Writes the machine-readable data contract (arkiv/contract.schema.json) from the code. Run after changing a schema:
//   npx tsx scripts/contract.ts
import { writeFileSync } from "node:fs";
import { dataContract } from "@proof-of-life/core";

writeFileSync(new URL("../arkiv/contract.schema.json", import.meta.url), JSON.stringify(dataContract(), null, 2) + "\n");
console.log("wrote arkiv/contract.schema.json");
