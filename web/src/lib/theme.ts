export type Tone = "yellow" | "green" | "blue" | "purple" | "teal" | "gray";

export const TONES: Record<Tone, string> = {
  yellow: "#f9df6d",
  green: "#a0c35a",
  blue: "#b0c4ef",
  purple: "#ba81c5",
  teal: "#7ec8c3",
  gray: "#e3e3e1",
};

export const INK = "#18181b";
export const MUTED = "#5c5c5c";
export const FAINT = "#8a8a8a";
export const LINE = "#e5e5e5";
export const PAPER = "#ffffff";
export const ACCENT = "#d0021b";
export const GOOD = "#1a7f37";

export const ROOMS: Record<
  string,
  { tone: Tone; kicker: string }
> = {
  greenlight: { tone: "yellow", kicker: "Promo vs outcome" },
  rollout: { tone: "blue", kicker: "Country Top 10" },
  promo: { tone: "green", kicker: "YouTube operation" },
  studio: { tone: "purple", kicker: "Warehouse + curator" },
};
