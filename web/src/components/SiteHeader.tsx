"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DURATION, EASE } from "@/lib/motion";
import { PRODUCT_NAME } from "@/lib/config";
import { UserMenu } from "./UserMenu";

const NAV = [
  { href: "/dashboard", label: "Documents" },
  { href: "/chat", label: "Ask" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();

  return (
    // Named for view transitions: it stays perfectly still while the page under it changes.
    <header className="border-b border-rule" style={{ viewTransitionName: "site-header" }}>
      {/* gap-3 on phones: signed in, "Sign out" needs the room at 320px. */}
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-5 sm:gap-8 sm:px-8">
        <Link href="/" className="font-serif text-2xl tracking-tight">
          {PRODUCT_NAME}
          <sup className="ml-0.5 font-mono text-xs text-mark">1</sup>
        </Link>

        <nav aria-label="Main" className="flex gap-3 text-sm sm:gap-6">
          {NAV.map(({ href, label }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative py-1 ${active ? "text-ink" : "text-ink-soft hover:text-ink"}`}
              >
                {label}
                {/* One bar shared by all links (same layoutId): moving to another page
                    slides it across instead of one underline vanishing and another
                    appearing. Under reduced motion it simply moves (MotionConfig). */}
                {active && (
                  <motion.span
                    layoutId="nav-underline"
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-0.5 h-0.5 bg-mark"
                    transition={{ duration: DURATION.page, ease: EASE.out }}
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <UserMenu />
      </div>
    </header>
  );
}
