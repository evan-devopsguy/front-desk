"use client";

export function LogoutButton() {
  async function onClick() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <button
      onClick={onClick}
      className="rounded-full border border-ink/20 px-3 py-1 text-xs hover:bg-ink/5"
    >
      Sign out
    </button>
  );
}
