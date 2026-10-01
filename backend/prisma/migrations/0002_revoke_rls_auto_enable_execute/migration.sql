-- public.rls_auto_enable() is Supabase's event-trigger function (fired by the `ensure_rls`
-- event trigger) that auto-enables RLS on new tables in `public`. It is SECURITY DEFINER and
-- was executable by anon/authenticated via /rest/v1/rpc/rls_auto_enable. Only the event
-- trigger needs to run it, so revoke direct EXECUTE from the API roles.
--
-- Guarded with an existence check: the function only exists in the Supabase project DB, not
-- in the empty shadow database `prisma migrate dev` replays migrations into.
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated, public;
  END IF;
END
$$;
