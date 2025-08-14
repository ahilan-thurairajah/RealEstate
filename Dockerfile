# Use an official Node.js runtime as a parent image.
# Using a specific version like 18-slim is recommended for stability.
FROM node:18-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json first to leverage Docker's build cache.
# This avoids re-installing dependencies on every code change.
COPY package*.json ./

# Install application dependencies using 'npm ci' which is faster and more reliable for builds
RUN npm ci --only=production

# Copy the rest of the application source code into the container
COPY . .

# The application listens on the port defined by the PORT environment variable, defaulting to 5173.
# Cloud Run automatically sets the PORT variable, so the app will listen on the correct port.
# We can expose 5173 here for documentation purposes, but Cloud Run will manage the actual port.
EXPOSE 5173

# Define the command to run the application
CMD ["node", "server.mjs"]
