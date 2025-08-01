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

## ⚙️ Changing the Port

To use a different port, edit the PORT environment variable in the docker-compose.yml file.

Example (for port 443):

```bash
environment:
  - PORT=443
```

## ⚠️ Project Status

This project is under active development and is currently in a prototype phase.
Use with caution and do not deploy to production environments until further stabilization and security hardening.
