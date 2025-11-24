# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm install

# Copy all source files
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install serve globally to run the built app
RUN npm install -g serve

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Start the application
CMD ["serve", "-s", "dist", "-l", "3000", "-n"]
