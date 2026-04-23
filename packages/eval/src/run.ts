#!/usr/bin/env tsx
import { closePool } from "../../../apps/api/src/db/client.js";
import { scenarios } from "./scenarios.js";
import { runScenario, type ScenarioResult } from "./harness.js";
import { seedEvalTenants } from "./seed.js";

async function main() {
  console.log("seeding eval tenants...");
  await seedEvalTenants();

  const results: ScenarioResult[] = [];
  for (const s of scenarios) {
    process.stdout.write(`▶ ${s.id} ... `);
    try {
      const r = await runScenario(s);
      results.push(r);
      process.stdout.write(r.pass ? "PASS\n" : "FAIL\n");
      if (!r.pass) {
        for (const f of r.failures) console.log(`   - ${f}`);
      }
    } catch (err) {
      const r: ScenarioResult = {
        id: s.id,
        pass: false,
        failures: [`threw: ${(err as Error).message}`],
        replies: [],
        finalOutcome: null,
        intent: null,
      };
      results.push(r);
      process.stdout.write("FAIL\n");
      console.log(`   - ${r.failures[0]}`);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n${passed}/${total} scenarios passed`);

  await closePool();
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
