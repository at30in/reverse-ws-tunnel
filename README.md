# 🧪 Reverse WebSocket Tunnel (Prototype)

This project is a **reverse WebSocket tunnel**, packaged as a Docker container.  
⚠️ The software is currently in **prototype stage** and not recommended for production use.

---

## 🐳 Building the Docker Image

To build the Docker image, run:

```bash
npm run docker:build
```

## 🚀 Running the Server

To start the server container:

```bash
npm run docker:deploy
```

By default, the service will start on port 4443.

## ⚙️ Environment Variables

You can also set configuration via environment variables:

| Variable               | Description                                               |
| ---------------------- | --------------------------------------------------------- |
| `TUNNEL_ID`            | Tunnel unique identifier                                  |
| `WS_URL`               | WebSocket server URL                                      |
| `TARGET_URL`           | Target URL for forwarding                                 |
| `TUNNEL_ENTRY_URL`     | Optional tunnel entry URL                                 |
| `TUNNEL_ENTRY_PORT`    | TCP port for tunnel entry                                 |
| `HEADERS`              | Optional headers JSON string                              |
| `ALLOW_INSICURE_CERTS` | Allow insecure SSL certificates (`true`/`false`)          |
| `LOG_LEVEL`            | Logging level (`error`, `warn`, `info`, `debug`, `trace`) |

## ⚠️ Project Status

This project is under active development and is currently in a prototype phase.
Use with caution and do not deploy to production environments until further stabilization and security hardening.
