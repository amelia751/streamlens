"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ROOMS, type Tone } from "@/lib/theme";

const LINKS: { href: string; label: string; tone: Tone }[] = [
  { href: "/data", label: "Data", tone: ROOMS.data.tone },
  { href: "/studio", label: "Studio", tone: ROOMS.studio.tone },
];

export function SiteNav() {
  const path = usePathname();

  return (
    <nav className="site-nav">
      <Link href="/" className="wordmark">
        Streamlens
      </Link>
      <div className="nav-links">
        {LINKS.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={
              path.startsWith(n.href) ? `on tone-${n.tone}` : undefined
            }
          >
            {n.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
