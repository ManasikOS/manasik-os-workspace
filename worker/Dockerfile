# The always-on Inbox worker (Q3). Build from the repository root:
#
#   docker build -f worker/Dockerfile -t inbox-worker .
#
# The image holds code only. Every secret is passed at run time as an environment variable by the platform's secret store, never
# baked in: see docs/runbooks/inbox-worker.md for the list. The build fails if the worker's code cannot load, so a broken image is
# never produced.
#
# Not verified in this repository's CI yet: the Dockerfile was written without a running Docker daemon. Run the build once before
# relying on it.

# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Only what the bundle imports (worker/, lib/, utils/ and two files under app/). Nothing else from the repository enters the image.
COPY tsconfig.json ./
COPY worker ./worker
COPY lib ./lib
COPY utils ./utils
COPY app ./app

RUN npm run worker:build
# Proves every job handler loads under plain Node. It connects to nothing; the values are placeholders, not credentials.
RUN NEXT_PUBLIC_SUPABASE_URL=https://build.invalid SUPABASE_SECRET_KEY=build-placeholder node dist-worker/worker.cjs --check

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

# The bundle keeps third-party packages external, so the runtime image needs the production dependencies.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist-worker ./dist-worker

# The health port is the only listener. Nothing else is exposed and the worker takes no inbound requests.
EXPOSE 8080
USER node
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_PORT||process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# SIGTERM (a deploy or a scale-down) starts a graceful stop: claiming stops, running jobs finish or are handed back.
CMD ["node", "dist-worker/worker.cjs"]
