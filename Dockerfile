FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY test ./test
COPY migrations ./migrations
COPY web ./web
RUN npm run build

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production
# Chromium for career pages that only render in a browser (src/browser.ts).
RUN apk add --no-cache chromium
ENV CHROMIUM_PATH=/usr/bin/chromium
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY migrations ./migrations
USER node
CMD ["node", "dist/src/main.js"]
