FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ dist/
EXPOSE 8080
VOLUME ["/root/.opti-moa"]
ENTRYPOINT ["node", "dist/index.js"]
