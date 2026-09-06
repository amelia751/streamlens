"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboards/greenlight", label: "Greenlight" },
  { href: "/dashboards/rollout", label: "Rollout" },
  { href: "/dashboards/promo", label: "Promo" },
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
