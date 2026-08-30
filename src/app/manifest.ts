import type { MetadataRoute } from "next";

// Web App Manifest — makes FinOps an installable PWA with a proper name,
// standalone (chrome-less) display, and home-screen icons. Served at
// /manifest.webmanifest and linked from the root layout's metadata.
//
// iOS uses the apple-touch-icon (see app/apple-icon.png) for the home-screen
// icon; Android/Chrome build the home-screen / WebAPK icon from the icons below.
// The maskable 512 lets Android render an edge-to-edge adaptive launcher icon
// rather than a letterboxed tile. The background/theme colour is the official
// brand tile (#0F1714), so the Android PWA splash and OS chrome match the
// home-screen icon.
//
// NB: each PNG is purpose "any maskable" — the SAME image serves both the
// legacy ("any") slot and the Android adaptive ("maskable") slot. Splitting
// them across separate "any" and "maskable" entries left this Chrome WebAPK
// shell (v181) without a single icon it would accept for the adaptive slot, so
// it minted the app with a generated letter icon instead of the pill. The PNGs
// are opaque + full-bleed with the mark inside the maskable safe zone (see
// scripts/gen_icons.py), which is exactly what a maskable icon requires. The
// SVG is intentionally NOT in the manifest (the WebAPK launcher can't
// rasterise it); it still serves as the browser-tab favicon via the layout.
//
// start_url points straight at /budgets (a real page) rather than "/", because
// "/" 307-redirects (to /budgets when signed in, /login otherwise). A
// redirecting start_url can make Chrome's WebAPK minting degrade to a plain
// home-screen shortcut with a *generated letter icon* instead of the manifest
// pill — so we keep the installed-app entry point on a non-redirecting URL.
// `id` pins the app identity to "/" so this (and future) start_url changes
// don't fork the install; `scope` keeps the whole origin in-app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FinOps",
    short_name: "FinOps",
    description: "Personal finance — budgets & net worth at a glance.",
    id: "/",
    start_url: "/budgets",
    scope: "/",
    display: "standalone",
    background_color: "#0F1714",
    theme_color: "#0F1714",
    // Next's Manifest type allows only a single `purpose` literal
    // ('any' | 'maskable' | 'monochrome'), but the web manifest spec permits the
    // space-separated combination "any maskable" — one image serving both the
    // legacy and the Android adaptive (maskable) slot. We emit that combined
    // value (the form that makes Chrome mint the pill instead of a generated
    // letter) and assert past the overly-strict type.
    icons: [
      { src: "/icon-192.png", type: "image/png", sizes: "192x192", purpose: "any maskable" },
      { src: "/icon-512.png", type: "image/png", sizes: "512x512", purpose: "any maskable" },
    ] as unknown as MetadataRoute.Manifest["icons"],
  };
}
