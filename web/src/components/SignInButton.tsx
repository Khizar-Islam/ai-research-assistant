"use client";

// A sign-in form's submit button that shows the wait. Signing in takes a moment (a server
// round trip, then for Google a redirect away), and without feedback a second click looks
// necessary. While the form is submitting: a "…ing" label, the ochre activity dot (still,
// with reduced motion), and the button can't be pressed again.
import { useFormStatus } from "react-dom";

type Props = { label: string; pendingLabel: string; className: string };

export function SignInButton({ label, pendingLabel, className }: Props) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={`${className} disabled:cursor-wait`}>
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="size-1.5 bg-ochre motion-safe:animate-ripple" />
          {pendingLabel}
        </span>
      ) : (
        label
      )}
    </button>
  );
}
