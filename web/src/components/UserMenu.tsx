"use client";

// The header's right side: who is signed in, and Sign out; or Sign in when nobody is.
import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useState } from "react";
import { forgetApiToken } from "@/lib/apiTokenClient";

export function UserMenu() {
  const { data: session, status } = useSession();
  const queryClient = useQueryClient();
  const [leaving, setLeaving] = useState(false);

  if (status === "loading") return <span className="ml-auto" aria-hidden="true" />;

  if (!session?.user) {
    return (
      <Link href="/signin" className="link-underline ml-auto text-sm text-ink-soft hover:text-ink">
        Sign in
      </Link>
    );
  }

  const { name, email, image } = session.user;
  const label = name ?? email ?? "Signed in";

  async function handleSignOut() {
    setLeaving(true);
    // Nothing of this account may linger in the tab for the next one: its token and every
    // cached document list, passage and answer.
    forgetApiToken();
    queryClient.clear();
    await signOut({ redirectTo: "/" });
  }

  return (
    // On phones only "Sign out" shows (the photo and name need room the header doesn't have).
    <div className="ml-auto flex items-center gap-3">
      {image ? (
        <Image src={image} alt="" width={28} height={28} className="hidden size-7 border border-rule sm:block" referrerPolicy="no-referrer" />
      ) : (
        <span aria-hidden="true" className="hidden size-7 items-center justify-center border border-rule font-mono text-[11px] text-ink-soft sm:flex">
          {initials(label)}
        </span>
      )}
      <span className="hidden max-w-40 truncate text-sm sm:block" title={email ?? undefined}>
        {label}
      </span>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={leaving}
        className="link-underline text-sm whitespace-nowrap text-ink-soft hover:text-mark disabled:opacity-50"
      >
        {leaving ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}

function initials(label: string): string {
  const parts = label.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : (parts[0] ?? "?").slice(0, 2)).toUpperCase();
}
