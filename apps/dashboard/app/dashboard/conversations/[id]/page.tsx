import { listMessages } from "../../../../lib/api";

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await searchParams;
  if (!tenantId) return <p>tenantId required</p>;
  const messages = await listMessages(tenantId, id);

  return (
    <section className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Conversation</h1>
      <div className="mt-6 space-y-3">
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "patient"
                ? "ml-0 max-w-[75%] rounded-2xl bg-white px-4 py-2 text-sm shadow-sm"
                : m.role === "assistant"
                  ? "ml-auto max-w-[75%] rounded-2xl bg-ink px-4 py-2 text-sm text-cream shadow-sm"
                  : "mx-auto max-w-full rounded-md bg-ink/5 px-3 py-2 text-xs text-ink/70"
            }
          >
            <p className="whitespace-pre-wrap">{m.content}</p>
            <p className="mt-1 text-[10px] opacity-60">
              {m.role} · {new Date(m.createdAt).toLocaleTimeString()}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
