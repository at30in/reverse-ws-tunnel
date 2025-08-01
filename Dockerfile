FROM node:22.16.0-alpine3.22

RUN mkdir -p /usr/src/app/node_modules && chown -R node:node /usr/src/app

# Create app directory
WORKDIR /usr/src/app

COPY package*.json ./

USER node
COPY --chown=node:node . .
RUN  npm ci

ENV ENVIRONMENT='dev'
ENV PORT='4443'
ENV SRC_ADDR='localhost'
ENV SRC_PORT='8083'
ENV DST_ADDR='localhost'
ENV DST_PORT='80'

EXPOSE 4443

CMD [ "npm", "run", "start" ]