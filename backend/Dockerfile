# Use a slim version of Node.js 18 LTS as the base image.
# Alpine is a lightweight Linux distribution, good for smaller images.
FROM node:18-alpine

# Set the working directory inside the container.
# All subsequent commands will be run from this directory.
WORKDIR /app

# Copy package.json and package-lock.json first.
# This step is crucial for Docker caching. If only your source code changes,
# but dependencies don't, Docker can reuse the result of 'npm install'.
COPY package*.json ./

# Install backend dependencies.
# '--production' flag installs only production dependencies, making the image smaller.
RUN npm install --production

# Copy the rest of your backend application code into the container.
# This includes server.js, and any other JS files needed by your backend.
COPY . .

# Expose the port that your application listens on.
# Cloud Run will route traffic to this port.
EXPOSE 8080

# Define the command to run your application when the container starts.
# This tells Cloud Run to execute your server.js file using Node.js.
CMD ["node", "server.js"]
