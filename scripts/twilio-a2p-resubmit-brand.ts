#!/usr/bin/env tsx
/**
 * Resubmit A2P 10DLC brand registration as Low Volume Standard.
 *
 * Background: prior SOLE_PROPRIETOR submission (BN7d88…c123) failed with
 * error 30794 — CloudOps Solutions LLC has an EIN, so SP brand type
 * doesn't apply. Twilio's API has no LOW_VOLUME_STANDARD enum value;
 * Low Volume Standard is just BrandType=STANDARD + SkipAutomaticSecVet=true.
 * That skips the paid secondary vetting at the cost of capping throughput
 * to <6000 msgs/day across carriers — fine for our volume.
 *
 * Prereqs (script enforces both):
 *   - A2P trust bundle status == "twilio-approved"
 *   - CP  trust bundle status == "twilio-approved"
 *
 * Usage:
 *   tsx --env-file=.env scripts/twilio-a2p-resubmit-brand.ts \
 *       --cp-bundle BUxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
 *       [--a2p-bundle BU9c5d37ee2a3b54516a2893b244138bed]
 *
 * Helpful flags:
 *   --dry-run    Print the request body and exit without POSTing.
 *   --list-cp    List approved Customer Profile bundles and exit.
 */

const A2P_BUNDLE_DEFAULT = "BU9c5d37ee2a3b54516a2893b244138bed";
const TRUSTHUB_BASE = "https://trusthub.twilio.com/v1";
const MESSAGING_BASE = "https://messaging.twilio.com/v1";

type Args = {
  cpBundle?: string;
  a2pBundle: string;
  dryRun: boolean;
  listCp: boolean;
};

function parseArgs(argv: string[]): Args {
  const a: Args = { a2pBundle: A2P_BUNDLE_DEFAULT, dryRun: false, listCp: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--cp-bundle" && v) { a.cpBundle = v; i++; }
    else if (k === "--a2p-bundle" && v) { a.a2pBundle = v; i++; }
    else if (k === "--dry-run") a.dryRun = true;
    else if (k === "--list-cp") a.listCp = true;
    else if (k === "--help" || k === "-h") { printHelpAndExit(0); }
    else if (k?.startsWith("--")) { console.error(`unknown flag: ${k}`); printHelpAndExit(1); }
  }
  return a;
}

function printHelpAndExit(code: number): never {
  console.error(
    "Usage: tsx --env-file=.env scripts/twilio-a2p-resubmit-brand.ts " +
      "--cp-bundle BU... [--a2p-bundle BU...] [--dry-run] [--list-cp]"
  );
  process.exit(code);
}

function authHeader(): string {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  if (!sid || !token) {
    throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set (try --env-file=.env)");
  }
  return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

async function twilio<T>(method: "GET" | "POST", url: string, body?: URLSearchParams): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(),
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body?.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status}\n${text}`);
  }
  return JSON.parse(text) as T;
}

type Bundle = { sid: string; friendly_name: string; status: string };

async function getBundle(sid: string): Promise<Bundle> {
  return twilio<Bundle>("GET", `${TRUSTHUB_BASE}/TrustProducts/${sid}`)
    .catch(() => twilio<Bundle>("GET", `${TRUSTHUB_BASE}/CustomerProfiles/${sid}`));
}

async function listApprovedCps(): Promise<Bundle[]> {
  const res = await twilio<{ results: Bundle[] }>(
    "GET",
    `${TRUSTHUB_BASE}/CustomerProfiles?Status=twilio-approved&PageSize=50`
  );
  return res.results ?? [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.listCp) {
    const cps = await listApprovedCps();
    if (!cps.length) { console.error("No approved Customer Profiles found."); process.exit(1); }
    console.log("Approved Customer Profile bundles:");
    for (const cp of cps) console.log(`  ${cp.sid}  ${cp.friendly_name}`);
    return;
  }

  if (!args.cpBundle) {
    console.error("Missing --cp-bundle. Run with --list-cp to see candidates.");
    process.exit(1);
  }

  // Pre-flight: both bundles must be twilio-approved.
  const [cp, a2p] = await Promise.all([getBundle(args.cpBundle), getBundle(args.a2pBundle)]);
  console.log(`CP  ${cp.sid}  status=${cp.status}  (${cp.friendly_name})`);
  console.log(`A2P ${a2p.sid}  status=${a2p.status}  (${a2p.friendly_name})`);

  const blockers: string[] = [];
  if (cp.status !== "twilio-approved") blockers.push(`CP bundle status is "${cp.status}", need "twilio-approved"`);
  if (a2p.status !== "twilio-approved") blockers.push(`A2P bundle status is "${a2p.status}", need "twilio-approved"`);
  if (blockers.length) {
    console.error("\nRefusing to submit — blockers:");
    for (const b of blockers) console.error(`  - ${b}`);
    console.error("\nRe-run this script once both bundles flip to twilio-approved.");
    process.exit(2);
  }

  // Build request: STANDARD + SkipAutomaticSecVet=true == Low Volume Standard.
  const body = new URLSearchParams({
    CustomerProfileBundleSid: args.cpBundle,
    A2PProfileBundleSid: args.a2pBundle,
    BrandType: "STANDARD",
    SkipAutomaticSecVet: "true",
  });

  console.log("\nRequest:");
  console.log(`  POST ${MESSAGING_BASE}/a2p/BrandRegistrations`);
  for (const [k, v] of body) console.log(`    ${k}=${v}`);

  if (args.dryRun) { console.log("\n--dry-run: not submitting."); return; }

  const result = await twilio<{ sid: string; status: string; brand_type: string; tcr_id?: string | null }>(
    "POST",
    `${MESSAGING_BASE}/a2p/BrandRegistrations`,
    body
  );
  console.log("\nSubmitted:");
  console.log(`  sid:        ${result.sid}`);
  console.log(`  status:     ${result.status}`);
  console.log(`  brand_type: ${result.brand_type}  (Low Volume Standard via SkipAutomaticSecVet)`);
  if (result.tcr_id) console.log(`  tcr_id:     ${result.tcr_id}`);
  console.log("\nNext steps:");
  console.log("  1. Poll status: GET /v1/a2p/BrandRegistrations/" + result.sid);
  console.log("  2. Once APPROVED, register a Messaging Campaign under this brand.");
  console.log("  3. Attach +19097669426 to a Messaging Service tied to that campaign.");
}

main().catch((err) => { console.error(err); process.exit(1); });
