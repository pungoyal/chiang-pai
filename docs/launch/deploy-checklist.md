# Deploy checklist for the trips release

This release changes the schema (migrations 0017 and 0018). Pushing to `main` runs CI, builds the image, and runs the one-shot `migrate` service against the live database before the app restarts.

1. **Back up.** `docker exec chiang-pai-db-1 pg_dump -U chiangpai chiangpai > backup-$(date +%F).sql` on the box. The migration is forward-only.
2. **Check the live `.env`.** Remove `FOUNDING_MEMBERS`, `MAX_STAKE_PIES`, `GROUP_LANGUAGE`, `GROUP_DESTINATION` (they are ignored now, harmless if left). `RANKED_MIN_RESOLVED` stays. `AUTH_URL` must be the public https hostname.
3. **Push.** The migration turns the existing table into trip `chiang-mai` ("Chiang Mai", Thailand, INR home, THB foreign), founders into organisers, and everything else into that trip. Rename it from `/t/chiang-mai/settings`.
4. **Verify.** `pnpm stats` inside the app container (or `node scripts/stats.ts`) should show 1 trip with everyone on it; the old bookmarks (`/members`, `/bills`, `/talk`) redirect to `/trips`.
5. **Google console.** Add `/privacy` and `/terms` URLs to the OAuth consent screen.
6. **Tell the group.** Everyone sees a one-time "I'm 18+ and I agree" bar; that is the terms gate for members who predate it.
