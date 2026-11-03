FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
COPY packages/web/package.json ./packages/web/
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci
COPY . .
ENV VITE_API_URL=""
RUN npm run build
RUN npm run build:server

FROM node:20-alpine AS proddeps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
COPY packages/web/package.json ./packages/web/
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --omit=dev

FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/web/dist /usr/share/nginx/html

FROM node:20-alpine AS server
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY package.json ./
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=build /app/packages/server/dist ./packages/server/dist
USER node
EXPOSE 4000
CMD ["node", "packages/server/dist/index.js"]
