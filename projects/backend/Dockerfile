FROM node:26-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3500

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p logs uploads/documents/invoices microservices/outbox

EXPOSE 3500

CMD ["npm", "start"]
