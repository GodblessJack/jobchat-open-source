FROM node:25-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY jchat/package*.json ./jchat/
COPY meeting/package*.json ./meeting/
COPY landing/package*.json ./landing/
RUN npm ci && npm --prefix jchat ci && npm --prefix meeting ci && npm --prefix landing ci

COPY . .
RUN npm run build

FROM node:25-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY jchat/package*.json ./jchat/
RUN npm ci --omit=dev && npm --prefix jchat ci --omit=dev && npm cache clean --force

COPY --from=build /app/gateway.js ./gateway.js
COPY --from=build /app/scripts/start-production.mjs ./scripts/start-production.mjs
COPY --from=build /app/jchat/dist ./jchat/dist
COPY --from=build /app/jchat/scripts ./jchat/scripts
COPY --from=build /app/jchat/sql ./jchat/sql
COPY --from=build /app/jchat/drizzle ./jchat/drizzle
COPY --from=build /app/meeting/build ./meeting/build
COPY --from=build /app/landing/build ./landing/build
COPY --from=build /app/LICENSE /app/NOTICE /app/THIRD_PARTY_NOTICES.md ./
COPY --from=build /app/licenses ./licenses

RUN mkdir -p /data/jchat-sessions /data/jobchat/files && chown -R node:node /data /app
USER node

EXPOSE 3000 5272
CMD ["node", "scripts/start-production.mjs"]
