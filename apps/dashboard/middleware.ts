import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Gate everything under /dashboard behind a signed-in session. The session
 * cookie is iron-session encrypted; we can't read it cleanly in middleware
 * without the runtime, so we check for cookie presence and defer real
 * verification to the page (which calls getSession()).
 */
export function middleware(req: NextRequest) {
  const isDashboard = req.nextUrl.pathname.startsWith("/dashboard");
  if (!isDashboard) return NextResponse.next();
  const hasSession = req.cookies.get("medspa_session");
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
