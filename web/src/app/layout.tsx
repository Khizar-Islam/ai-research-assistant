import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import { auth } from "@/auth";
import { SiteHeader } from "@/components/SiteHeader";
import { ServerWakeNotice } from "@/components/ServerWakeNotice";
import { PRODUCT_NAME } from "@/lib/config";
import { Providers } from "./providers";
import "./globals.css";

// next/font downloads these at build time and serves them from this app, so there's no
// request to Google from the visitor's browser and no layout shift while fonts load.
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"], // optical size: finer detail at display sizes, sturdier at small ones
  variable: "--font-newsreader",
});
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: "Ask questions about your own documents and get answers that cite their sources.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Read on the server for every render, so the header knows who's signed in on first
  // paint, including right after an in-app sign-in (which doesn't reload the page).
  const session = await auth();

  return (
    <html lang="en" className={`${newsreader.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh bg-paper font-sans text-ink">
        <Providers session={session}>
          <SiteHeader />
          <ServerWakeNotice />
          {children}
        </Providers>
      </body>
    </html>
  );
}
