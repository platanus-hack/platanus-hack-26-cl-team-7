# Stage 1: build the React client
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: production server
FROM node:22-alpine AS server
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=client-build /app/client/dist ../client/dist

RUN mkdir -p /data

ENV NODE_ENV=production
ENV DB_PATH=/data/budget.db
ENV PORT=3111

EXPOSE 3111
VOLUME ["/data"]

CMD ["node", "index.js"]
