FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

RUN npm install -g npm@11.20.0

COPY package*.json ./

RUN npm ci --omit=dev

COPY dist/ ./

USER node

EXPOSE 3000

CMD ["node", "server.js"]
