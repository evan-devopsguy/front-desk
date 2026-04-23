import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface Session {
  email?: string;
  signedInAt?: string;
}

const options: SessionOptions = {
  password:
    process.env.DASHBOARD_SESSION_SECRET ??
    "dev-session-secret-change-me-32bytes-min",
  cookieName: "medspa_session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  },
};

export async function getSession(): Promise<IronSession<Session>> {
  const c = await cookies();
  return getIronSession<Session>(c, options);
}
