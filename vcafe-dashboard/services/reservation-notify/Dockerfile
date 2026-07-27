FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
# Cloud Run Job として1回実行して終了する。
CMD ["npm", "start"]
