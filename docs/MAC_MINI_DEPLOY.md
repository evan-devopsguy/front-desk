# Mac Mini deployment — runbook

The Mac Mini is the production host for **Cooper Family Garage Doors only**.
Every other tenant should go to the cloud deploy (fly.io / Railway / Render),
which uses the same code but a different infra path. This runbook is the
one-time setup; after step 8, normal deploys happen on every push to `main`.

## Single-tenant guarantee (read first)

This Mac Mini is intentionally scoped to one tenant. The `seed-tenant.ts`
script has a `--confirm <twilio-number>` guard that requires you to type the
number you intend to seed when `NODE_ENV=production`. **Never run
`pnpm db:seed` for any tenant other than Cooper Family on this Postgres
instance.** When customer #2 needs onboarding, deploy them to fly.io instead.

---

## Prerequisites

- A Mac Mini running macOS 14+ on a wired network behind a UPS.
- A Tailscale account (free) — public ingress runs through Tailscale Funnel
  on the host, no domain registration needed. The Mini gets a stable
  `*.<tailnet>.ts.net` HTTPS URL.
- An IAM user in your AWS account with **only** `bedrock:InvokeModel` on the
  three model IDs in `.env.production.example`. The Terraform module at
  `infra/terraform-bedrock/` provisions it; outputs the access key + secret.
- Twilio Account SID + Auth Token (already pasted into `.env`; same values
  go into `.env.production`).
- An existing checkout of `front-desk` at `/Users/evan/Create/Code/front-desk`
  on the Mini (the deploy workflow assumes this absolute path — adjust the
  `working-directory` and `safe.directory` lines if you put it elsewhere).
- `node@20+` and `pnpm@9.12+` installed on the host (`brew install node && corepack enable`).
  These are used by Step 7's `pnpm db:seed` invocation, which runs on the
  host (not inside a container) so it can reach the loopback-bound Postgres
  with a script that ships as TypeScript via `tsx`.

---

## Step 1 — Install Docker

Docker Desktop is the obvious choice but its license terms are gray for
hosting a friend's business. Two free alternatives that are drop-in for
this stack:

- **OrbStack** (recommended for Apple Silicon Mac Minis) — lighter than
  Docker Desktop, free for personal use. Install from orbstack.dev.
- **Colima** (`brew install colima docker docker-compose`) — fully OSS.

Whichever you pick, verify with `docker compose version` (must be v2+).

---

## Step 2 — macOS power & boot settings

Open **System Settings → Energy** and:

- ☑ Start up automatically after a power failure
- ☑ Prevent automatic sleeping when the display is off
- (Optional) ☑ Wake for network access

Then in a terminal:

```bash
sudo pmset -a disablesleep 1
sudo pmset -a sleep 0
sudo pmset -a displaysleep 30   # display can sleep, machine cannot
```

Disable automatic macOS updates so a security patch doesn't reboot the box
mid-call:

```bash
sudo softwareupdate --schedule off
```

(Apply updates manually during a low-call window — Sundays before 8am work
well for a garage-door business.)

---

## Step 3 — Register a self-hosted GitHub Actions runner for *this repo*

The Mac Mini may already have a runner serving `local-seo`. **Add a second
one for `front-desk` rather than reusing it** — they can run side-by-side
and the deploy workflow uses a label (`front-desk`) to target the right one.

1. In GitHub: repo → **Settings → Actions → Runners → New self-hosted runner**.
2. Pick **macOS** / **arm64** (or **x64** for older Minis).
3. Follow the install commands GitHub gives you, but install into a
   *separate* directory from any existing runner:
   ```bash
   mkdir ~/actions-runner-front-desk && cd ~/actions-runner-front-desk
   # paste the curl + tar lines GitHub showed you
   ./config.sh --url https://github.com/<your-org>/front-desk \
     --token <token-github-gave-you> \
     --name "mac-mini-front-desk" \
     --labels "front-desk" \
     --work _work
   ```
4. Install as a launchd service so it auto-starts on boot:
   ```bash
   ./svc.sh install
   ./svc.sh start
   ./svc.sh status   # confirm it's running
   ```
5. Back in GitHub the runner should show **Idle** with the `front-desk` label.

---

## Step 4 — Set up Tailscale Funnel

We use Tailscale Funnel instead of port-forwarding because: (a) it gives
you a stable HTTPS URL with a managed cert, (b) no inbound ports opened
on the home network, (c) it survives ISP IP changes, (d) it's free with
no domain registration. Tailscale runs on the host (NOT in a container)
and forwards public traffic to `127.0.0.1:3001`, which `docker-compose.prod.yml`
publishes from the api container.

1. **Sign up at https://tailscale.com** (free personal plan).
2. **Install Tailscale on the Mac Mini.** Easiest path is the GUI app:
   ```bash
   brew install --cask tailscale
   open -a Tailscale
   ```
   Click "Log in" in the menu-bar icon (VNC into the Mini if needed) and
   complete browser auth. Confirm with `tailscale status` in a terminal.
3. **Note the device's MagicDNS hostname.** Run `tailscale status --json |
   python3 -c "import sys,json; print(json.load(sys.stdin)['Self']['DNSName'])"`.
   You'll get something like `mac-mini.tail1234.ts.net.` — this is your
   public hostname (drop the trailing dot).
4. **Enable HTTPS + Funnel for your tailnet** (one-time, in admin console):
   - https://login.tailscale.com/admin/dns → enable **MagicDNS** + **HTTPS Certificates**.
   - https://login.tailscale.com/admin/acls → add a `nodeAttrs` rule granting
     `funnel` to the Mini. Minimal config:
     ```json
     {
       "nodeAttrs": [
         {"target": ["tag:funnel"], "attr": ["funnel"]}
       ],
       "tagOwners": {"tag:funnel": ["autogroup:admin"]}
     }
     ```
     Then tag the Mini: `sudo tailscale up --advertise-tags=tag:funnel`.
5. **Start Funnel forwarding `:443` → `127.0.0.1:3001`:**
   ```bash
   sudo tailscale funnel --bg 3001
   ```
   `--bg` makes it persist across reboots. Verify with `tailscale funnel status`.
6. The hostname is now `https://mac-mini.tail1234.ts.net` (use yours from
   step 3) and that's what goes into `PUBLIC_BASE_URL` in `.env.production`.


---

## Step 5 — Populate `.env.production` on the Mac Mini

```bash
cd /Users/evan/Create/Code/front-desk
cp .env.production.example .env.production
# Edit and fill every blank — the only "ROTATE BEFORE DEPLOY" one is:
#   POSTGRES_PASSWORD  — openssl rand -hex 16
$EDITOR .env.production
```

There are no operator-facing services in this deployment — only the API,
Postgres, and host-level Tailscale. PHI inspection happens via direct
psql queries (see Day-2 ops below).

---

## Step 6 — First deploy

From the Mini, kick the deploy workflow manually:

1. GitHub → repo → **Actions → Deploy to Mac Mini → Run workflow**.
2. Leave services as `all`. Run.

The runner will pull the latest `main`, build the api image, run migrations
against the freshly-created Postgres, and bring everything up. Watch the
job log; it should take ~3–5 minutes the first time and finish with
"api healthy". After it succeeds, hit the Tailscale Funnel URL externally
(e.g. from your phone on cellular): `curl https://<tailnet>.ts.net/health`
should return 200.

**Sanity check after first build** — confirm the migrations folder really
made it into the api image (the Dockerfile copies it explicitly because
tsc doesn't move .sql files):

```bash
docker compose -f docker-compose.prod.yml run --rm \
  --entrypoint sh api -c 'ls apps/api/dist/db/migrations | head'
```

Should list `001_*.sql`, `002_*.sql`, etc. If it errors with "No such
file", rebuild with `--no-cache`:
`docker compose -f docker-compose.prod.yml build --no-cache api`.

---

## Step 7 — Seed Cooper Family

This is the only time you'll ever run `db:seed` on this Postgres.

```bash
cd /Users/evan/Create/Code/front-desk
# Use the host's pnpm + node since the runner installed them.
# DATABASE_URL points at the loopback-bound prod postgres.
DATABASE_URL=postgres://medspa:$(grep '^POSTGRES_PASSWORD=' .env.production | cut -d= -f2)@localhost:5432/medspa \
NODE_ENV=production \
pnpm db:seed -- \
  --vertical    garage-doors \
  --name        "Cooper Family Garage Doors" \
  --twilio      "+19097669426" \
  --owner-phone "+17145537547" \
  --timezone    "America/Los_Angeles" \
  --url         "https://cooperfamilygaragedoors.com/" \
  --confirm     "+19097669426"
```

The `--confirm` value must match `--twilio` exactly — the production safety
guard refuses to seed otherwise. Expect "tenant ready" plus a chunk count
from the website ingest.

---

## Step 8 — Rewrite Twilio webhook URLs

Last step. Until you do this, Twilio still points at the old setup (voice
forwarded to Craig's cell directly; SMS unwired). From the Mini:

```bash
set -a && . ./.env.production && set +a
PUBLIC=$PUBLIC_BASE_URL   # e.g. https://api.cooperfamily.example.com

# Look up the IncomingPhoneNumber SID for +19097669426. Do this dynamically
# rather than hardcoding — the SID is stable but always derive it.
NUMBER_SID=$(
  curl -sS -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
    "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/IncomingPhoneNumbers.json?PhoneNumber=%2B19097669426" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['incoming_phone_numbers'][0]['sid'])"
)

curl -sS -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -X POST "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/IncomingPhoneNumbers/$NUMBER_SID.json" \
  --data-urlencode "SmsUrl=$PUBLIC/twilio/sms" \
  --data-urlencode "SmsMethod=POST" \
  --data-urlencode "VoiceUrl=$PUBLIC/twilio/voice" \
  --data-urlencode "VoiceMethod=POST" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('sms_url:', d['sms_url']); print('voice_url:', d['voice_url'])"
```

Then run the smoke tests in `docs/ONBOARDING.md` step 5 — including the
ring-owner-first scenario at step 7.

---

## Migration constraints

The deploy workflow runs migrations *before* recreating the api container,
which means the OLD api briefly talks to the NEW schema. This is safe for
**additive** migrations (new column, new table, new index) and unsafe for
**destructive** ones (drop column, rename column, drop table). If you need
a destructive migration:

1. Ship a deploy that adds the new shape alongside the old (additive).
2. Wait until both shapes are in place and the old is unused.
3. Ship a second deploy that drops the old shape.

The workflow does not enforce this — it's on you to remember.

## Day-2 operations

| Task | How |
|---|---|
| Routine deploy | Push to `main` — runner auto-deploys whatever changed. |
| Manual rebuild | Actions → Deploy to Mac Mini → Run workflow → choose service. |
| View logs | `docker compose -f docker-compose.prod.yml logs -f api` |
| Restart everything | `docker compose -f docker-compose.prod.yml restart` |
| Stop everything | `docker compose -f docker-compose.prod.yml down` (postgres data persists) |
| Rotate a secret | Edit `.env.production`, run `docker compose -f docker-compose.prod.yml up -d --force-recreate api`. |
| Tail audit log | `docker exec medspa-postgres psql -U medspa -c "SELECT * FROM audit_log ORDER BY at DESC LIMIT 50;"` |

## Backups (TODO before Cooper Family is "real production")

Not built yet. Recommended setup:

1. AWS S3 bucket with versioning + 30-day retention.
2. macOS launchd plist at `~/Library/LaunchAgents/com.cooperfamily.pgbackup.plist`
   running daily at 03:30 PT:
   ```bash
   docker exec medspa-postgres pg_dump -U medspa medspa \
     | gzip \
     | aws s3 cp - s3://cooperfamily-prod-backups/pg/$(date +%Y%m%d).sql.gz
   ```
3. Monthly restore drill — `pg_restore` into a scratch DB and confirm row
   counts match. Otherwise you have a backup you've never tested, which is
   a backup you don't have.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Deploy job fails on "Run database migrations" | Old image cached without the migrations COPY in the Dockerfile | `docker compose -f docker-compose.prod.yml build --no-cache api` then re-run |
| Twilio reports 403 from /twilio/* | `PUBLIC_BASE_URL` mismatch with the Tailscale Funnel URL | Make them byte-identical (no trailing slash, exact hostname) |
| API container restart loop | Default dev secrets still in `.env.production` | Look for `Refusing to start` in `docker logs medspa-api` |
| Tailscale Funnel returns 502 | api container not listening on `127.0.0.1:3001` | `docker compose -f docker-compose.prod.yml ps api`; if Up but unreachable, check the `ports:` mapping is `127.0.0.1:3001:3001` |
| `tailscale funnel` says "permission denied" | The Mini doesn't have the `funnel` nodeAttr in your tailnet ACL | See Step 4 — add `nodeAttrs` rule + `--advertise-tags=tag:funnel` |
| Postgres healthy but api says "ECONNREFUSED" | api started before postgres finished init on first boot | Wait — the depends_on healthcheck handles this; if it persists, check `docker logs medspa-postgres` |
