# Use a lightweight Node.js image
FROM node:lts-alpine

# Install Python and its dependencies
RUN apk add --no-cache python3 binutils

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the port your app runs on (assuming it's 3000 based on common Node.js practices)
EXPOSE 3000

# Define the command to run your application
CMD [ "node", "server.js" ]
