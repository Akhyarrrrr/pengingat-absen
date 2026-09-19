FROM mcr.microsoft.com/playwright:v1.61.0-noble

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY monitor.js ./
COPY tools/ ./tools/
RUN mkdir -p runtime

CMD ["sleep", "infinity"]