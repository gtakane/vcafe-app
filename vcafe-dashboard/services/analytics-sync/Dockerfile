FROM node:22-slim
WORKDIR /app
COPY services/analytics-sync/package.json ./package.json
RUN npm install --omit=dev
COPY lib ./lib
COPY services/analytics-sync/src ./services/analytics-sync/src
CMD ["node", "--import=tsx", "services/analytics-sync/src/index.ts"]
