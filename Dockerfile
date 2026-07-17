FROM node:22-slim

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install --production

COPY src/ src/

RUN mkdir -p /root/.opti-moa

EXPOSE 8080

CMD ["npx", "tsx", "src/server.ts"]
