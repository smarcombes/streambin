import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Streambin",
  description: "Private encrypted streams for agents",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-black/10 bg-white/80 backdrop-blur dark:border-white/10 dark:bg-black/70">
          <nav className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-3 sm:px-10">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Streambin
            </Link>
            <div className="flex items-center gap-4 text-sm">
              <Link href="/" className="opacity-80 hover:opacity-100">
                Docs
              </Link>
              <Link href="/demo" className="opacity-80 hover:opacity-100">
                Demo
              </Link>
            </div>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
