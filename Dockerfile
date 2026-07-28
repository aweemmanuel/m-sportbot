FROM node:20-slim

# Install Playwright dependencies (Chromium + system libs)
RUN npx playwright install --with-deps chromium

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install --production=false

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create download directory for cache
RUN mkdir -p /app/data

# Set environment variables
ENV NODE_ENV=production
ENV CACHE_PATH=/app/data/.msport-cache.sqlite
ENV PORT=8080

# Expose health check port
EXPOSE 8080

# Start the bot
CMD ["node", "dist/main.js"]
