FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/

FROM node:20-slim
WORKDIR /app
COPY --from=build /app .

RUN npx playwright install --with-deps chromium

EXPOSE 3000
CMD ["node", "src/app.js"]
