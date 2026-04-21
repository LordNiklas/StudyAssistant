#!/bin/bash

# Script to check if the backend builds successfully
echo "Checking if backend builds successfully..."

# Change to the backend directory
cd "$(dirname "$0")/backend" || { echo "Error: Could not change to backend directory"; exit 1; }

# Check if port 3000 is already in use
if lsof -i:3000 -t >/dev/null; then
  echo "Notice: Port 3000 is already in use. This is okay as the server will try an alternative port."
fi

# Run npm start with a timeout to avoid hanging indefinitely
# We redirect stderr to stdout and use grep to check for errors
timeout 10s npm run start 2>&1 | tee build.log

# Check if the process timed out
if [ $? -eq 124 ]; then
  echo "Build check timed out. This could mean the server started successfully."
  
  # Check the log for common startup messages that indicate success
  if grep -q "Server running on port" build.log; then
    echo "Server appears to have started successfully."
    # Clean up
    rm -f build.log
    # Kill any node processes that might have been started
    pkill -f "node index.js" || true
    exit 0
  else
    echo "Could not confirm if server started successfully."
    # Clean up
    rm -f build.log
    # Kill any node processes that might have been started
    pkill -f "node index.js" || true
    exit 1
  fi
fi

# Check for common error patterns in the log
if grep -q "Error:" build.log || grep -q "error:" build.log || grep -q "SyntaxError" build.log; then
  echo "Build failed. See errors above."
  # Clean up
  rm -f build.log
  exit 1
fi

# If we get here, assume the build was successful
echo "Backend build successful!"
# Clean up
rm -f build.log
exit 0