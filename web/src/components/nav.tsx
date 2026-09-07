"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/rooms/greenlight", label: "Greenlight" },
  { href: "/rooms/rollout", label: "Rollout" },
  { href: "/rooms/promo", label: "Promo" },
  { href: "/studio", label: "Studio" },
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
            className={path.startsWith(n.href) ? "on" : undefined}
          >
            {n.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
