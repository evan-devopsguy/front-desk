import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../lib/session";
import { listTenants } from "../../lib/api";
import { LogoutButton } from "./LogoutButton";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session.email) redirect("/login");

  const tenants = await listTenants().catch(() => []);
  const first = tenants[0];

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col">
      <header className="flex items-center justify-between border-b border-ink/10 px-8 py-4">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="font-semibold">
            MedSpa AI
          </Link>
          <nav className="flex gap-6 text-sm text-ink/70">
            <Link
              href={
                first
                  ? `/dashboard/conversations?tenantId=${first.id}`
                  : "/dashboard"
              }
            >
              Conversations
            </Link>
            <Link
              href={
                first
                  ? `/dashboard/bookings?tenantId=${first.id}`
                  : "/dashboard"
              }
            >
              Bookings
            </Link>
            <Link href="/dashboard/settings">Settings</Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-ink/70">
          <span>{session.email}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
