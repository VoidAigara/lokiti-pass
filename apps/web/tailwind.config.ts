import type { Config } from "tailwindcss";

/**
 * Premium palette bound to CSS custom properties (see globals.css).
 * Every theme-dependent color is stored as an "R G B" triplet so Tailwind
 * opacity modifiers (`/15`) keep working. Dark is the default theme,
 * light via `[data-theme="light"]` on <html>.
 *
 * `black` is intentionally aliased to the hairline color: every legacy
 * `border-black` renders as a thin quiet line instead of a poster frame.
 */
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1280px" },
    },
    colors: {
      transparent: "transparent",
      current: "currentColor",
      black: v("--c-line"),
      white: v("--c-card"),
      paper: v("--c-paper"),
      card: v("--c-card"),
      ink: v("--c-ink"),
      line: v("--c-line"),
      soft: v("--c-soft"),
      body: v("--c-body"),
      faint: v("--c-faint"),
      muted: v("--c-muted"),
      label: v("--c-label"),
      magenta: v("--c-magic"),
      // text ramp bound to theme (200 = body … 500 = labels);
      // 600–950 stay fixed neutral for rare inverted surfaces
      zinc: {
        50: v("--c-card"),
        100: v("--c-soft"),
        200: v("--c-body"),
        300: v("--c-faint"),
        400: v("--c-muted"),
        500: v("--c-label"),
        600: "#52525B",
        700: "#3F3F46",
        800: "#27272A",
        900: "#18181B",
        950: "#0A0A0C",
      },
      emerald: {
        200: "#B2F9DF",
        300: "#6DF2BC",
        400: v("--c-ok-dot"),
        500: "#00C46A",
        600: "#00A85C",
        700: v("--c-ok-text"),
      },
      red: {
        200: "#FFC9D4",
        300: "#FFA3B5",
        400: "#FF6B85",
        500: "#FF3B5E",
        600: v("--c-bad-text"),
      },
      amber: {
        200: "#FFE9A8",
        300: "#FFDC6E",
        400: "#FFC94D",
        500: "#FFB020",
        600: "#E08700",
        700: v("--c-warn-text"),
      },
      // surfaces: 950/900 = ink/paper, 800 = cards, 700 = ink fills,
      // 600 = hairline
      void: {
        950: v("--c-ink"),
        900: v("--c-paper"),
        800: v("--c-card"),
        700: v("--c-ink"),
        600: v("--c-line"),
      },
      magic: {
        DEFAULT: v("--c-magic"),
        light: v("--c-magic-light"),
        dark: v("--c-magic-dark"),
      },
      surface: "rgb(var(--c-ink) / 0.04)",
      hairline: "rgb(var(--c-line))",
    },
    fontFamily: {
      display: [
        "var(--font-unbounded)",
        '"Unbounded"',
        "var(--font-inter)",
        "sans-serif",
      ],
      sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      mono: ["var(--font-mono)", "ui-monospace", "monospace"],
    },
    boxShadow: {
      glow: "0 1px 2px rgb(0 0 0 / 0.05)",
      card: "0 1px 2px rgb(0 0 0 / 0.06), 0 24px 48px -32px rgb(0 0 0 / 0.45)",
      pop3: "0 1px 2px rgb(0 0 0 / 0.05)",
      pop4: "0 1px 2px rgb(0 0 0 / 0.06)",
      "pop-magic3": "0 8px 24px -10px rgb(var(--c-magic) / 0.4)",
      "pop-magic4": "0 12px 32px -12px rgb(var(--c-magic) / 0.45)",
    },
    keyframes: {
      "accordion-down": {
        from: { height: "0", opacity: "0" },
        to: {
          height: "var(--radix-accordion-content-height)",
          opacity: "1",
        },
      },
      "accordion-up": {
        from: {
          height: "var(--radix-accordion-content-height)",
          opacity: "1",
        },
        to: { height: "0", opacity: "0" },
      },
      float: {
        "0%,100%": { transform: "translateY(0px)" },
        "50%": { transform: "translateY(-10px)" },
      },
      "pulse-glow": {
        "0%,100%": { opacity: "0.55" },
        "50%": { opacity: "1" },
      },
      shimmer: {
        "100%": { transform: "translateX(100%)" },
      },
      "spin-slow": {
        from: { transform: "rotate(0deg)" },
        to: { transform: "rotate(360deg)" },
      },
      "toast-in": {
        from: { opacity: "0", transform: "translateY(-12px)" },
        to: { opacity: "1", transform: "translateY(0)" },
      },
    },
    animation: {
      "accordion-down": "accordion-down 0.25s ease-out",
      "accordion-up": "accordion-up 0.25s ease-out",
      float: "float 6s ease-in-out infinite",
      "float-slow": "float 9s ease-in-out infinite",
      "pulse-glow": "pulse-glow 3.2s ease-in-out infinite",
      shimmer: "shimmer 2.5s infinite",
      "spin-slow": "spin-slow 24s linear infinite",
      "toast-in": "toast-in 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
    },
    borderRadius: {
      none: "0",
      sm: "4px",
      DEFAULT: "6px",
      md: "8px",
      lg: "10px",
      xl: "12px",
      "2xl": "16px",
      "3xl": "20px",
      "4xl": "24px",
      full: "9999px",
    },
  },
  plugins: [],
};

export default config;
