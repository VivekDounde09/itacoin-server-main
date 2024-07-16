# base image
FROM node:18 AS base

WORKDIR /itacoin

ARG PORT

RUN npm install pm2 --location=global

COPY package.json .
COPY package-lock.json .
COPY prisma/schema.prisma prisma/schema.prisma
COPY src/ledger/contracts/abi src/ledger/contracts/abi

ENV HUSKY=0

RUN npm install

COPY . .

EXPOSE ${PORT}

# development image
FROM base AS itacoin-dev

CMD ["npm", "run", "start:dev"]

# production image
FROM base AS itacoin

RUN npm run build

CMD ["pm2-runtime", "dist/main.js", "--name", "itacoin", "--wait-ready", "--listen-timeout 60000", "--kill-timeout", "60000"]
