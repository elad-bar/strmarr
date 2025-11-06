FROM node:18-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Update npm to ensure compatibility with lockfileVersion 3 (npm 10.x is compatible with Node 18)
RUN npm install -g npm@10

# Install dependencies
RUN npm ci --omit=dev

# Copy application files
COPY index.js ./

# Run the application
CMD ["node", "index.js"]
