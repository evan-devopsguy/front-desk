import { listTenants } from "../../../lib/api";

export default async function SettingsPage() {
  const tenants = await listTenants();

  return (
    <section className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-2 text-sm text-ink/60">
        Tenant config is edited via the API for MVP. The dashboard is
        read-only. A self-serve editor ships with the post-MVP release.
      </p>
      <ul className="mt-6 space-y-3 text-sm">
        {tenants.map((t) => (
          <li
            key={t.id}
            className="rounded border border-ink/10 bg-white px-4 py-3"
          >
            <p className="font-medium">{t.name}</p>
            <p className="text-xs text-ink/60">id: {t.id}</p>
            <p className="text-xs text-ink/60">
              Twilio: {t.twilioNumber} · adapter: {t.bookingAdapter}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
