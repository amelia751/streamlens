import type { IconName } from "@/lib/theme";

export function EnvIcon({ name }: { name: IconName }) {
  return (
    <svg
      className="env-icon"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths(name)}
    </svg>
  );
}

function paths(name: IconName) {
  switch (name) {
    case "grid":
      return (
        <>
          <rect x="8" y="8" width="32" height="32" rx="2" />
          <path d="M8 20h32M8 28h32M20 8v32M28 8v32" />
        </>
      );
    case "star":
      return (
        <path d="M24 7l4.8 12.4H42l-10.6 7.7 4 12.4L24 32.8 12.6 39.5l4-12.4L6 19.4h13.2z" />
      );
    case "hex":
      return <path d="M24 6l16 9v18l-16 9-16-9V15z" />;
    case "diamond":
      return <path d="M24 6l18 18-18 18L6 24z" />;
    case "tiles":
      return (
        <>
          <rect x="8" y="8" width="13" height="13" rx="3" />
          <rect x="27" y="8" width="13" height="13" rx="3" />
          <rect x="8" y="27" width="13" height="13" rx="3" />
          <rect x="27" y="27" width="13" height="13" rx="3" />
        </>
      );
    case "plus":
      return (
        <>
          <circle cx="24" cy="24" r="16" />
          <path d="M24 16v16M16 24h16" />
        </>
      );
  }
}
