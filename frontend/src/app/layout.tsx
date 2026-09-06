import type { Metadata } from "next";
import { Geist_Mono, Libre_Franklin, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const franklin = Libre_Franklin({
  variable: "--font-franklin",
  subsets: ["latin"],
});

const serif = Source_Serif_4({
  variable: "--font-cheltenham",
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
      className={`${franklin.variable} ${serif.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
