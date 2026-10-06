# TODO

- `/admin/quotes` is not built yet. Quotes are saved and admins can read all of them in Postgres, but no page lists them.
- Security: a role change in Keycloak only reaches the app at the user's next sign in. A removed admin keeps reading every quote while their session lives. Fix: on role change, end the user's Keycloak sessions (back-channel logout then ends the app sessions too).
- Expired rows in `session` are never cleaned up (Better Auth only deletes one when its browser comes back or signs out). Fix: in `lib/auth.ts` add a `databaseHooks.session.create.after` hook that runs `DELETE FROM session WHERE "expiresAt" < now()` on every sign in, like Better Auth already does for `verification`. Add an index on `session("expiresAt")` in `docker/postgres/02-auth.sql` so the delete stays cheap.
- Rejected API requests are logged but not counted. Add a metric once there is a metrics system.
- Quotes that fail to save are only logged (with input and quote), not counted or retried. Add a metric and a way to replay them from the log.
