import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MedSpa AI",
  description: "After-hours receptionist for medical spas.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-cream text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
