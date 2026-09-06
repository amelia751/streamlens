import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full bg-white antialiased`}
    >
      <body className="min-h-full bg-white">{children}</body>
    </html>
  );
}
