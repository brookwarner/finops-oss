import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Manrope } from "next/font/google";
import "./globals.css";
import { LaunchSplash } from "@/components/launch-splash";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-hanken",
  display: "swap",
});

// Manrope powers the brand wordmark on the PWA launch splash (per docs/brand).
// preload:false — the splash is display:none outside standalone PWAs, so plain
// browser tabs never render the wordmark and shouldn't pay to fetch the font.
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["800"],
  variable: "--font-manrope",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "FinOps",
  description: "Personal finance",
  manifest: "/manifest.webmanifest",
  // Favicons / link-rel icons. Declared explicitly (rather than via the
  // app/icon.* file convention) so we can ship raster PNGs alongside the SVG.
  // This matters on Android: when Chrome creates a *shortcut* instead of a
  // WebAPK (older Chrome, non-GMS devices, or the "Add to Home screen" path),
  // the home-screen icon is taken from these link-rel icons / the favicon. With
  // only an SVG favicon, Chrome can't rasterise it and falls back to a
  // generated letter ("F"); the PNG entries give it the brand pill to use. iOS
  // is handled separately by app/apple-icon.png (apple-touch-icon).
  icons: {
    icon: [
      { url: "/favicon-16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
      { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
    ],
  },
  // Treat as a standalone app when added to the iOS home screen, and give it a
  // proper title under the icon. The home-screen icon itself comes from
  // app/apple-icon.png (apple-touch-icon). The dark status bar matches the
  // brand tile so the chrome blends into the app on launch.
  appleWebApp: { capable: true, title: "FinOps", statusBarStyle: "black-translucent" },
};

// Brand tile colour (#0F1714) — drives the mobile browser/OS chrome and the
// Android PWA splash background so they match the home-screen icon.
export const viewport: Viewport = { themeColor: "#0F1714" };

// Set the theme class before first paint so there's no light-mode flash on
// reload. Honours a saved choice, falling back to the OS preference.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${hanken.variable} ${manrope.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-bg font-sans text-ink antialiased">
        {children}
        <LaunchSplash />
      </body>
    </html>
  );
}
