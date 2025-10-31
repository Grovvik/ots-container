# OTS Validator Container

OTS validator running in a Docker container.

## Configuration

Before running the container, you must configure the following environment variables in `index.js`:

- `KEY`: Replace with your wallet's private key.
- `PEERS`: Replace with a comma-separated list of validator WebSocket endpoints.  
  Example: `"ws://127.0.0.1:3000,ws://192.168.0.101:3001"`

Make sure to update these values before starting the service.

## Usage

```bash
docker build -t node-app .
docker run -d node-app
```

Ensure the application is properly configured to connect to the desired network nodes.
