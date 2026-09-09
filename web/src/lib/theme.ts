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

/**
 * A room's masthead, in one place.
 *
 * The page and its loading screen both spread this, so the header is drawn
 * from the first frame and reads the same before and after the data lands.
 */
export const ROOMS: Record<
  string,
  { tone: Tone; title: string; lede: string }
> = {
  data: {
    tone: "yellow",
    title: "Data",
    lede: "By title performance and YouTube campaigns.",
  },
  studio: {
    tone: "purple",
    title: "Studio",
    lede: "Build dashboards and theme proposals.",
  },
};
