FROM node:22-alpine AS base
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
EXPOSE 3000

CMD ["sh", "-c", "npm run build && npm run start"]