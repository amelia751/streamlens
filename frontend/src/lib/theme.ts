export type Tone = "yellow" | "green" | "blue" | "purple" | "teal" | "gray";

export type IconName =
  | "star"
  | "hex"
  | "diamond"
  | "tiles"
  | "plus"
  | "grid";

export const TONES: Record<Tone, string> = {
  yellow: "#f9df6d",
  green: "#a0c35a",
  blue: "#b0c4ef",
  purple: "#ba81c5",
  teal: "#7ec8c3",
  gray: "#e3e3e1",
};

export const INK = "#121212";
export const MUTED = "#5a5a5a";
export const FAINT = "#999999";
export const LINE = "#dfdfdf";
export const PAPER = "#ffffff";
export const CREAM = "#faf6ee";
export const ACCENT = "#d0021b";
export const GOOD = "#1a7f37";

export const ROOMS: Record<
  string,
  { tone: Tone; icon: IconName; kicker: string }
> = {
  greenlight: { tone: "yellow", icon: "star", kicker: "Promo vs outcome" },
  rollout: { tone: "blue", icon: "diamond", kicker: "Ninety-four countries" },
  promo: { tone: "green", icon: "tiles", kicker: "Forty-four channels" },
  title: { tone: "purple", icon: "plus", kicker: "Title dossier" },
};
