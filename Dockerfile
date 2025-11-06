FROM node:18-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies (generates package-lock.json during build)
RUN npm install --omit=dev

# Copy application files
COPY index.js ./

# Run the application
CMD ["node", "index.js"]
