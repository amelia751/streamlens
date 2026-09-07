import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

import { SiteNav } from "@/components/nav";
import { TitleDialogProvider } from "@/components/title-link";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Streamlens",
    template: "%s · Streamlens",
  },
  description:
    "What a studio promotes, against what actually performs — public streaming data in ClickHouse Cloud, read by a Gemini agent on Google Cloud.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${mono.variable} h-full bg-white antialiased`}
    >
      <body className="min-h-full bg-white">
        <TitleDialogProvider>
          <SiteNav />
          {children}
        </TitleDialogProvider>
      </body>
    </html>
  );
}
