import { listTenants } from "../../lib/api";

export default async function DashboardHome() {
  const tenants = await listTenants();
  return (
    <section>
      <h1 className="text-2xl font-semibold">Tenants</h1>
      <ul className="mt-6 divide-y divide-ink/10 rounded-lg border border-ink/10 bg-white">
        {tenants.map((t) => (
          <li key={t.id} className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="font-medium">{t.name}</p>
              <p className="text-xs text-ink/60">
                {t.twilioNumber} · adapter: {t.bookingAdapter}
              </p>
            </div>
            <div className="flex gap-3 text-sm">
              <a
                href={`/dashboard/conversations?tenantId=${t.id}`}
                className="rounded-full border border-ink/20 px-3 py-1 hover:bg-ink/5"
              >
                Conversations
              </a>
              <a
                href={`/dashboard/bookings?tenantId=${t.id}`}
                className="rounded-full border border-ink/20 px-3 py-1 hover:bg-ink/5"
              >
                Bookings
              </a>
            </div>
          </li>
        ))}
        {tenants.length === 0 && (
          <li className="px-5 py-6 text-sm text-ink/60">
            No tenants yet. Run <code>pnpm db:seed</code> to add one.
          </li>
        )}
      </ul>
    </section>
  );
}
