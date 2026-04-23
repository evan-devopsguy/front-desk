import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center px-8 py-24">
      <p className="mb-3 text-sm uppercase tracking-[0.2em] text-accent">
        MedSpa AI
      </p>
      <h1 className="text-5xl font-semibold leading-tight">
        Your after-hours receptionist, on the clock while you sleep.
      </h1>
      <p className="mt-6 max-w-xl text-lg text-ink/70">
        Answers common questions, books appointments, and hands off medical
        questions to your team — in your spa's voice.
      </p>
      <div className="mt-10 flex gap-4">
        <Link
          href="/login"
          className="rounded-full bg-ink px-6 py-3 text-sm font-medium text-cream"
        >
          Owner sign in
        </Link>
      </div>
    </main>
  );
}
