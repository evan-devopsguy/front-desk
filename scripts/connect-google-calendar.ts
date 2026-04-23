#!/usr/bin/env tsx
/**
 * One-time OAuth handshake for the Google account that owns the calendar the
 * adapter writes to. Prints the refresh_token and calendar list; the operator
 * then stores the secret in Secrets Manager.
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... pnpm connect:google-calendar
 */
import http from "node:http";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];
const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}/oauth2/callback`;

async function main(): Promise<void> {
  const client_id = process.env["GOOGLE_CLIENT_ID"];
  const client_secret = process.env["GOOGLE_CLIENT_SECRET"];
  if (!client_id || !client_secret) {
    console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in env.");
    process.exit(1);
  }

  const oauth = new google.auth.OAuth2(client_id, client_secret, REDIRECT);
  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url?.startsWith("/oauth2/callback")) {
        res.writeHead(404);
        res.end();
        return;
      }
      const qs = new URL(req.url, `http://localhost:${PORT}`).searchParams;
      const c = qs.get("code");
      if (!c) {
        res.writeHead(400);
        res.end("no code");
        reject(new Error("no code in callback"));
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<h1>Done. You can close this tab.</h1>");
      server.close();
      resolve(c);
    });
    server.listen(PORT);
    console.log("\nOpen this URL in your browser and log in as the calendar owner:");
    console.log(url + "\n");
  });

  const { tokens } = await oauth.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "\nNo refresh_token returned. Revoke existing consent at https://myaccount.google.com/permissions and retry.",
    );
    process.exit(1);
  }

  oauth.setCredentials(tokens);
  const calendar = google.calendar({ version: "v3", auth: oauth });
  const list = await calendar.calendarList.list();

  console.log("\n--- OAuth success ---");
  console.log(
    JSON.stringify({ client_id, client_secret, refresh_token: tokens.refresh_token }, null, 2),
  );
  console.log("\nCalendars on this account:");
  for (const c of list.data.items ?? []) {
    console.log(`  ${c.id}  —  ${c.summary}${c.primary ? "  (primary)" : ""}`);
  }
  console.log(
    "\nStore the JSON above in Secrets Manager:\n  aws secretsmanager create-secret --name '<tenant_id>/booking/google-calendar' --secret-string file://creds.json",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
