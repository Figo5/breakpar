# Career Mode release checklist

Status: locally verified and ready for human PR review. Career is still
uncommitted and unshipped.

## PR composition

Include only:

- `.github/workflows/ci.yml`
- the reviewed Career integrations in `app/api/round/`, `app/globals.css`,
  `app/page.tsx`, `app/play/page.tsx`, `data/changelog.ts`, `package.json`,
  `prisma/schema.prisma`, `vercel.json`, and `vitest.career-db.config.ts`;
- `app/api/career/**`, `app/career/**`, `lib/career/**`;
- the two Career migrations named below;
- `docs/career-*.md`, `scripts/career-*.ts`;
- `tests/career*.ts`, `tests/career*.spec.ts`, and
  `tests/botPlayer.test.ts`.

Explicitly exclude unrelated local artifacts, including `.claude/`,
`.osm-cache/`, `sawgrass.txt`, and non-Career investigation/recovery scripts.
Do not use an unreviewed blanket `git add .`.

## Deployment shape

Career is additive:

- `20260727000710_add_career_mode` creates only `Career*` enums, tables,
  indexes, and relations from Career rows to existing users, courses, and
  rounds.
- `20260727120000_career_partial_unique_indexes` adds the three filtered unique
  indexes required for exactly-once settlement and unique Championship slots.
- Existing Daily, Tournament, Challenge, practice, streak, and trophy rows are
  not rewritten.
- The previous production build can run safely after the migrations because it
  does not reference the new tables.

Production deployments use `scripts/vercel-build.sh`. On `VERCEL_ENV=production`
it generates Prisma Client, runs `prisma migrate deploy`, idempotently seeds the
course catalogue, and then builds Next.js. Preview deployments do not migrate or
seed.

## Before merge

1. Confirm the PR contains only the reviewed Career manifest.
2. Confirm `DATABASE_URL` remains the pooled runtime connection and
   `DIRECT_URL` remains the direct migration connection.
3. Confirm `CRON_SECRET` is configured in Vercel.
4. Run:

   ```sh
   npx prisma validate
   npx prisma migrate status
   npx tsc --noEmit
   npx vitest run
   npm run test:career-db
   npm run engine:calibrate
   npm run build
   git diff --check
   ```

5. Confirm a migration drift check reports no difference.
6. Review the Career changelog entry and responsive screenshots.

## Immediately after deployment

1. Confirm the Vercel deployment and production build completed.
2. Confirm both Career migrations are applied:

   ```sh
   npm run db:migrate:deploy
   npx prisma migrate status
   ```

3. Confirm these indexes exist in production:

   - `CareerSettlementAttempt_committed_unique`
   - `CareerChampionshipSlot_profile_unique`
   - `CareerChampionshipSlot_bot_unique`

4. Open Home on desktop and mobile and confirm Career Mode appears beside Play
   Unlimited.
5. Enroll one canary guest and confirm:

   - four events are immediately playable;
   - leaving and reopening an event resumes the same round;
   - opponent cards remain hidden before completion;
   - Daily and Unlimited entry points still work.

6. Invoke the authenticated Career tick once and confirm it returns `ok: true`
   with no errors.
7. Confirm an unauthenticated Career tick request returns `401` when
   `CRON_SECRET` is configured.
8. Run the read-only operational census:

   ```sh
   npx tsx scripts/career-ops.ts list
   ```

## Monitoring and recovery

Monitor:

- `[career] post-finish advance failed` application logs;
- Career tick summaries with non-empty `errors`;
- `FAILED_RETRYABLE` or `MANUAL_REVIEW` settlement attempts;
- FORMING seasons or Championships that remain after a recovery tick;
- ENDED events, seasons, or Championships that remain unsettled.

Inspect one aggregate without mutation:

```sh
npx tsx scripts/career-ops.ts inspect EVENT <id>
npx tsx scripts/career-ops.ts inspect SEASON <id>
npx tsx scripts/career-ops.ts inspect CHAMPIONSHIP <id>
```

Retry is dry-run by default. A reviewed retry requires `--commit`:

```sh
npx tsx scripts/career-ops.ts retry EVENT <id>
npx tsx scripts/career-ops.ts retry EVENT <id> --commit
```

## Rollback

Do not drop Career tables as an emergency rollback.

Because the migration is additive, roll back the application deployment to the
previous production build. The previous build ignores all Career tables, so
existing non-Career gameplay continues while Career data remains preserved.

Fix defects forward with a new additive migration or application deployment.
Only remove Career data or schema after a separate reviewed migration and data
retention decision.
