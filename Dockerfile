# Production image of the app. Postgres and Keycloak run from docker-compose.yml.
FROM node:26-alpine AS build
WORKDIR /app
RUN npm install --global pnpm@12.9.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# The price is fixed into the app at build time (see .env.example).
# lib/auth.ts reads KEYCLOAK_ISSUER and BETTER_AUTH_SECRET when the build imports it. Server env is read again at runtime,
# so these placeholders are only for this one command and never end up in the image.
COPY . .
ARG NEXT_PUBLIC_PRICE_PER_KW
RUN : "${NEXT_PUBLIC_PRICE_PER_KW:?Set the build arg NEXT_PUBLIC_PRICE_PER_KW}" \
	&& KEYCLOAK_ISSUER=http://build.invalid BETTER_AUTH_SECRET=build-only-placeholder pnpm build

# Only the traced server files, without node_modules or sources. server.js does not serve static files
# unless they are copied next to it.
FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

USER node
EXPOSE 3000
# 127.0.0.1, not localhost: Alpine resolves localhost to ::1, and the server listens on IPv4 only
HEALTHCHECK --interval=10s --timeout=5s --retries=3 CMD wget -qO /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
