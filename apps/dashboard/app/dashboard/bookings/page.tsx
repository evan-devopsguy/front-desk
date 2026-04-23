import { listBookings, listTenants } from "../../../lib/api";
import { labelsFor } from "../../../lib/vertical-labels";

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const { tenantId } = await searchParams;
  const tenants = await listTenants();
  const tenant = tenants.find((t) => t.id === tenantId) ?? tenants[0];
  if (!tenant) return <p className="text-sm">No tenants yet.</p>;

  const bookings = await listBookings(tenant.id);
  const labels = labelsFor(tenant.vertical);

  return (
    <section>
      <h1 className="text-2xl font-semibold">{tenant.name} — bookings</h1>
      <table className="mt-6 w-full overflow-hidden rounded-lg border border-ink/10 bg-white text-sm">
        <thead className="bg-ink/5 text-left">
          <tr>
            <th className="px-4 py-2">Service</th>
            <th className="px-4 py-2">When</th>
            <th className="px-4 py-2">{labels.contactLabel}</th>
            <th className="px-4 py-2">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {bookings.map((b) => (
            <tr key={b.id}>
              <td className="px-4 py-2 font-medium">{b.service}</td>
              <td className="px-4 py-2">
                {new Date(b.scheduledAt).toLocaleString()}
              </td>
              <td className="px-4 py-2">{b.contactName}</td>
              <td className="px-4 py-2">
                {b.estimatedValueCents
                  ? `$${(b.estimatedValueCents / 100).toFixed(0)}`
                  : "—"}
              </td>
            </tr>
          ))}
          {bookings.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-ink/60">
                No bookings yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
