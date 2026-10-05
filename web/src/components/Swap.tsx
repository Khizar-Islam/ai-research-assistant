"use client";

import { motion, useIsPresent, useReducedMotion } from "motion/react";
import type { ReactNode, Ref } from "react";
import { DURATION, EASE } from "@/lib/motion";

type Props = {
  children: ReactNode;
  className?: string;
  // With reduced motion: swap at once instead of a short fade. For controls, where the
  // fade adds nothing and the new control should be there the moment focus moves to it.
  instantWhenReduced?: boolean;
  ref?: Ref<HTMLDivElement>; // AnimatePresence mode="popLayout" measures the leaving side through this
};

// One side of a crossfade: put it in <AnimatePresence mode="popLayout" initial={false}>
// with a key per state, inside a `relative` parent. popLayout takes the leaving side out
// of the layout at once, so both sides overlap instead of the new one waiting.
//
// The leaving side is inert while it fades: a quick second click or Tab can't land on a
// control that is already on its way out (say, the confirm button of a delete).
export function SwapItem({ children, className, instantWhenReduced, ref }: Props) {
  const isPresent = useIsPresent();
  const reduced = useReducedMotion();
  const instant = reduced && instantWhenReduced;

  return (
    <motion.div
      ref={ref}
      inert={!isPresent}
      className={className}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: instant ? 0 : DURATION.swap, ease: EASE.out } }}
      exit={{ opacity: 0, transition: { duration: instant ? 0 : DURATION.swap, ease: EASE.in } }}
    >
      {children}
    </motion.div>
  );
}
