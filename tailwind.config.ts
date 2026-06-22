import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--font-hanken)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
      },
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        sunken: "rgb(var(--sunken) / <alpha-value>)",
        hairline: "rgb(var(--hairline) / <alpha-value>)",
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          strong: "rgb(var(--ink-strong) / <alpha-value>)",
          muted: "rgb(var(--muted) / <alpha-value>)",
          faint: "rgb(var(--faint) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          weak: "rgb(var(--accent-weak) / <alpha-value>)",
        },
        positive: {
          DEFAULT: "rgb(var(--positive) / <alpha-value>)",
          bar: "rgb(var(--positive-bar) / <alpha-value>)",
          weak: "rgb(var(--positive-weak) / <alpha-value>)",
        },
        negative: {
          DEFAULT: "rgb(var(--negative) / <alpha-value>)",
          bar: "rgb(var(--negative-bar) / <alpha-value>)",
          weak: "rgb(var(--negative-weak) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "rgb(var(--warning) / <alpha-value>)",
          bar: "rgb(var(--warning-bar) / <alpha-value>)",
        },
        outflow: "rgb(var(--outflow) / <alpha-value>)",
        reserve: {
          DEFAULT: "rgb(var(--reserve) / <alpha-value>)",
          weak: "rgb(var(--reserve-weak) / <alpha-value>)",
        },
        autopay: {
          DEFAULT: "rgb(var(--autopay) / <alpha-value>)",
          weak: "rgb(var(--autopay-weak) / <alpha-value>)",
        },
        savings: {
          DEFAULT: "rgb(var(--savings) / <alpha-value>)",
          weak: "rgb(var(--savings-weak) / <alpha-value>)",
        },
      },
      borderRadius: {
        card: "var(--radius-card)",
        row: "var(--radius-row)",
        control: "var(--radius-control)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        row: "var(--shadow-row)",
        pop: "var(--shadow-pop)",
      },
    },
  },
  plugins: [],
};

export default config;
