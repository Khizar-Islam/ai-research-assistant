// One motion vocabulary for the whole app, so every hover, swap and entrance feels like
// part of the same thing. Components use these instead of inventing their own timings.
//
// The CSS side (hover/press transitions) uses the same values; see the "Motion" section
// of app/globals.css. Keep the two in step.
import type { TargetAndTransition, Transition } from "motion/react";

// Seconds (motion's unit). CSS uses the same numbers in ms.
export const DURATION = {
  press: 0.12, // hover and press feedback
  swap: 0.2, // a label or control replaced by another
  enter: 0.35, // something new appearing
  page: 0.45, // page-level transitions (upper bound)
} as const;

// Arriving things decelerate into place; leaving things accelerate away.
export const EASE = {
  out: [0.22, 1, 0.36, 1] as [number, number, number, number],
  in: [0.4, 0, 1, 1] as [number, number, number, number],
} as const;

// Lists only animate their first few items in; the rest appear with them, so a long list
// never waits on a long chain of delays.
export const STAGGER = { step: 0.035, maxItems: 8 } as const;

export const staggerDelay = (index: number) => Math.min(index, STAGGER.maxItems) * STAGGER.step;

// Entrances and exits, ready to spread into a motion element.
export const enter = (delay = 0): Transition => ({ duration: DURATION.enter, ease: EASE.out, delay });
export const exit: Transition = { duration: DURATION.swap, ease: EASE.in };

// A looping animation (pulse, blink) when motion is welcome; nothing when the user has
// asked the OS to reduce motion. MotionConfig reducedMotion="user" stops movement, but not
// opacity or color loops, so loops must check for themselves.
export function loop(
  reduced: boolean | null,
  keyframes: TargetAndTransition,
  duration: number,
): { animate?: TargetAndTransition; transition?: Transition } {
  if (reduced) return {};
  return { animate: keyframes, transition: { duration, repeat: Infinity, ease: "easeInOut" } };
}
