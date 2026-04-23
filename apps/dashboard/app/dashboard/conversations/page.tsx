import Link from "next/link";
import { listConversations, listTenants } from "../../../lib/api";

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const { tenantId } = await searchParams;
  const tenants = await listTenants();
  const tenant = tenants.find((t) => t.id === tenantId) ?? tenants[0];
  if (!tenant) return <p className="text-sm">No tenants yet.</p>;

  const conversations = await listConversations(tenant.id);

  return (
    <section>
      <h1 className="text-2xl font-semibold">{tenant.name} — conversations</h1>
      <ul className="mt-6 divide-y divide-ink/10 rounded-lg border border-ink/10 bg-white">
        {conversations.map((c) => (
          <li key={c.id} className="px-5 py-3 text-sm">
            <Link
              href={`/dashboard/conversations/${c.id}?tenantId=${tenant.id}`}
              className="flex items-center justify-between"
            >
              <div>
                <p className="font-medium">
                  {c.channel.toUpperCase()} · {c.contactPhoneHash?.slice(0, 8) ?? "unknown"}…
                </p>
                <p className="text-xs text-ink/60">
                  {new Date(c.createdAt).toLocaleString()}
                </p>
              </div>
              <StatusPill status={c.status} />
            </Link>
          </li>
        ))}
        {conversations.length === 0 && (
          <li className="px-5 py-6 text-sm text-ink/60">No conversations yet.</li>
        )}
      </ul>
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  const color: Record<string, string> = {
    active: "bg-blue-100 text-blue-800",
    booked: "bg-emerald-100 text-emerald-800",
    escalated: "bg-amber-100 text-amber-900",
    abandoned: "bg-ink/10 text-ink/70",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${color[status] ?? "bg-ink/10"}`}
    >
      {status}
    </span>
  );
}
