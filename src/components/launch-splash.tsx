"use client";

// Launch splash for the installed PWA (Android WebAPK / standalone display mode).
//
// Android's *system* splash is auto-composed by Chrome from the manifest
// (background_color + a manifest icon + the app name) and cannot be customised.
// To show the branded wordmark lockup from the brand guide (pill + "FinOps"
// with a muted "Ops" + a loading bar on the dark tile), we paint our own
// full-screen splash that hands off seamlessly from the system one: identical
// #0F1714 tile and pill, with the styled wordmark + loading bar layered on top.
//
// Gating: it's shown ONLY in standalone mode via the `display-mode: standalone`
// media query, so ordinary browser tabs never see it (no JS needed to decide).
//
// Lifecycle / why this is a client component: the markup is still server-rendered
// (client components SSR too), so it paints with the first HTML frame and hands
// off seamlessly from the system splash. Dismissal is driven from a `useEffect`,
// which is guaranteed to run once React hydrates — unlike the previous inline
// `<script>` (a Server Component rendering `<script dangerouslySetInnerHTML>`),
// whose client-side execution is unreliable in the App Router and, when it
// didn't run, left the splash (position:fixed; inset:0; max z-index) covering
// the app forever with no fallback. We hide on `load` (min ~450ms so it can't
// flicker), with a 5s JS safety cap. Belt-and-suspenders: a pure-CSS
// `fs-failsafe` keyframe force-fades the splash at ~6s even if JS never runs at
// all (hydration error, scripts disabled), so it can NEVER get permanently
// stuck. Because the root layout persists across client-side navigation, the
// splash only appears on a cold launch / hard reload — never on route changes.
//
// Colours/sizing/font mirror docs/brand: the dark-theme brighter pair
// (#34BE7C / #E08A57) and the brand wordmark face (Manrope, loaded in the root
// layout), with Hanken as the fallback while the font fetches.

import { useEffect } from "react";

const css = `
#finops-splash{display:none}
@media (display-mode:standalone){#finops-splash{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:#0F1714;animation:fs-failsafe .5s ease 6s forwards}}
#finops-splash{transition:opacity .38s ease}
#finops-splash .fs-glow{position:absolute;inset:0;background:radial-gradient(420px 220px at 50% 38%,rgba(52,190,124,.10),transparent 70%)}
#finops-splash svg{position:relative;width:92px;height:92px}
#finops-splash .fs-wm{position:relative;font-family:var(--font-manrope),var(--font-hanken),system-ui,-apple-system,sans-serif;font-weight:800;font-size:30px;letter-spacing:-.025em;line-height:1;color:#F2F4F0}
#finops-splash .fs-wm .fs-ops{color:rgba(242,244,240,.45)}
#finops-splash .fs-bar{position:absolute;bottom:46px;width:90px;height:4px;border-radius:99px;background:rgba(255,255,255,.10);overflow:hidden}
#finops-splash .fs-bar i{position:absolute;top:0;left:-42%;width:42%;height:100%;border-radius:99px;background:#34BE7C;animation:fs-slide 1.15s ease-in-out infinite}
@keyframes fs-slide{0%{left:-42%}100%{left:100%}}
@keyframes fs-failsafe{to{opacity:0;visibility:hidden;pointer-events:none}}
#finops-splash.finops-splash--hide{opacity:0;pointer-events:none;animation:none}
@media (prefers-reduced-motion:reduce){#finops-splash .fs-bar i{animation:none;left:0;width:62%}}
`;

export function LaunchSplash() {
  useEffect(() => {
    const s = document.getElementById("finops-splash");
    if (!s) return;
    const start = Date.now();
    let done = false;
    const hide = () => {
      if (done) return;
      done = true;
      const wait = Math.max(0, 450 - (Date.now() - start));
      setTimeout(() => {
        s.classList.add("finops-splash--hide");
        setTimeout(() => s.parentNode?.removeChild(s), 420);
      }, wait);
    };
    if (document.readyState === "complete") {
      hide();
    } else {
      window.addEventListener("load", hide);
    }
    const cap = setTimeout(hide, 5000);
    return () => {
      window.removeEventListener("load", hide);
      clearTimeout(cap);
    };
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div id="finops-splash" aria-hidden="true">
        <div className="fs-glow" />
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <path d="M47 38 H23 A12 12 0 0 0 11 50 A12 12 0 0 0 23 62 H47 Z" fill="#34BE7C" />
          <path d="M53 38 H77 A12 12 0 0 1 89 50 A12 12 0 0 1 77 62 H53 Z" fill="#E08A57" />
        </svg>
        <div className="fs-wm">
          Fin<span className="fs-ops">Ops</span>
        </div>
        <div className="fs-bar">
          <i />
        </div>
      </div>
    </>
  );
}
