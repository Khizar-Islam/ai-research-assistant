// Wraps a page's content so navigating between pages crossfades instead of cutting
// (styles in app/globals.css, "Page transitions"). In each page, not the layout: layouts
// persist across navigations, so their enter and exit would never fire.
//
// default="none": only page enter/exit animates. Data refreshes and other transitions
// inside the page don't.
import { ViewTransition, type ReactNode } from "react";

export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="page" exit="page" default="none">
      {children}
    </ViewTransition>
  );
}
