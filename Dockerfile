# Timay sunucusu
FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY desktop/package.json desktop/
RUN npm ci --workspace server --no-audit --no-fund

COPY server server

ENV PORT=4000 \
    DB_FILE=/data/timay.db
EXPOSE 4000
CMD ["npm", "start", "--workspace", "server"]
