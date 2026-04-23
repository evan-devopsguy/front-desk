import { redirect } from "next/navigation";
import { getSession } from "../../lib/session";

async function login(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const expectedEmail = process.env.DASHBOARD_LOGIN_EMAIL ?? "";
  const expectedPassword = process.env.DASHBOARD_LOGIN_PASSWORD ?? "";
  if (email !== expectedEmail || password !== expectedPassword) {
    redirect("/login?error=invalid");
  }
  const session = await getSession();
  session.email = email;
  session.signedInAt = new Date().toISOString();
  await session.save();
  redirect("/dashboard");
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-ink/60">
        Single shared owner credential for MVP.
      </p>
      <LoginForm action={login} searchParams={searchParams} />
    </main>
  );
}

async function LoginForm({
  action,
  searchParams,
}: {
  action: (fd: FormData) => Promise<void>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <form action={action} className="mt-8 space-y-4">
      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Invalid credentials.
        </p>
      )}
      <label className="block">
        <span className="text-sm text-ink/70">Email</span>
        <input
          name="email"
          type="email"
          required
          className="mt-1 w-full rounded border border-ink/10 bg-white px-3 py-2"
        />
      </label>
      <label className="block">
        <span className="text-sm text-ink/70">Password</span>
        <input
          name="password"
          type="password"
          required
          className="mt-1 w-full rounded border border-ink/10 bg-white px-3 py-2"
        />
      </label>
      <button
        type="submit"
        className="w-full rounded-full bg-ink px-5 py-3 text-sm font-medium text-cream"
      >
        Sign in
      </button>
    </form>
  );
}
