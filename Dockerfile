# Timay sunucusu (+ /uygulama/ adresindeki tarayıcı sürümü)

# 1) Tarayıcı sürümünü derle (Electron indirilmez, yalnız ekranlar derlenir)
FROM node:22-slim AS web
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY desktop/package.json desktop/
RUN npm ci --workspace desktop --ignore-scripts --no-audit --no-fund
COPY desktop desktop
RUN npm run build:web --workspace desktop

# 2) Sunucu
FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY desktop/package.json desktop/
RUN npm ci --workspace server --no-audit --no-fund

COPY server server
COPY --from=web /app/desktop/out-web desktop/out-web

ENV PORT=4000 \
    DB_FILE=/data/timay.db \
    WEB_DIR=/app/desktop/out-web
EXPOSE 4000
CMD ["npm", "start", "--workspace", "server"]
