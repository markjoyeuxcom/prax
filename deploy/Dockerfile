FROM node:24-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# A container bound to loopback is unusable by definition: published ports
# black-hole while the logs look healthy. Reaching the container at all is the
# operator's exposure decision (-p / --network), so the image bakes in the
# network bind plus the unauthenticated-listener acknowledgement it requires.
# The secure loopback default still governs bare-metal `node server/index.js`.
ENV HOST=0.0.0.0
ENV PRAX_ALLOW_UNAUTHENTICATED_NETWORK=true

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node mcp ./mcp
COPY --chown=node:node scripts/migrate.js ./scripts/migrate.js
COPY --chown=node:node scripts/backup-database.js ./scripts/backup-database.js
COPY --chown=node:node public ./public

USER node

EXPOSE 3000
CMD ["node", "server/index.js"]
