FROM node:24-alpine
WORKDIR /app
COPY runtime/package.json runtime/package-lock.json ./runtime/
RUN cd runtime && npm ci --omit=dev --ignore-scripts
COPY runtime ./runtime
COPY edge-demo ./edge-demo
USER node
WORKDIR /app/runtime
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node","server.mjs"]
