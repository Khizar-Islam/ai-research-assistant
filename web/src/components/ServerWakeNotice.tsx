"use client";

// Says what's going on when the API is slow to answer: on free hosting it sleeps when
// unused and the first request wakes it, which can take up to a minute. Without this, a
// first visit looks like a broken app. See lib/serverWake.ts for when it shows.
//
// Fixed just under the header (which is 64px tall, so top-18 clears it), centred, so it
// covers nothing important and pushes nothing around.
import { AnimatePresence, motion } from "motion/react";
import { useSyncExternalStore } from "react";
import { enter, exit } from "@/lib/motion";
import { isServerSlow, subscribeSlowServer } from "@/lib/serverWake";

export function ServerWakeNotice() {
  const slow = useSyncExternalStore(subscribeSlowServer, isServerSlow, () => false);

  return (
    // Always in the page, so screen readers hear the message when it appears.
    <div role="status" className="pointer-events-none fixed inset-x-0 top-18 z-40 flex justify-center px-4">
      <AnimatePresence>
        {slow && (
          <motion.div
            key="waking"
            className="pointer-events-auto max-w-md border border-l-2 border-rule border-l-ochre bg-paper-deep px-4 py-3 text-sm"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0, transition: enter() }}
            exit={{ opacity: 0, transition: exit }}
          >
            <p className="flex items-center gap-2 font-medium">
              <span aria-hidden="true" className="size-1.5 shrink-0 bg-ochre motion-safe:animate-ripple" />
              Waking the server up…
            </p>
            <p className="mt-1 text-ink-soft">
              It runs on free hosting and sleeps when nobody’s using it. The first request can take up to a minute.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
