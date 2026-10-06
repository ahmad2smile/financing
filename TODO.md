# TODO

- `/admin/quotes` is not built yet. Quotes are not saved.
- admin@test.com is seeded in Keycloak but has no admin role yet, and the app does not read roles.
- Expired rows in `session` are never cleaned up (Better Auth only deletes one when its browser comes back or signs out). Fix: in `lib/auth.ts` add a `databaseHooks.session.create.after` hook that runs `DELETE FROM session WHERE "expiresAt" < now()` on every sign in, like Better Auth already does for `verification`. Add an index on `session("expiresAt")` in `docker/postgres/02-auth.sql` so the delete stays cheap.
- Rejected API requests are logged but not counted. Add a metric once there is a metrics system.
