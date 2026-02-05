# Clawify

A TEE (Trusted Execution Environment) bootstrap process that runs [OpenClaw](https://docs.clawd.bot/) with secure crypto wallet access. The process automatically installs and configures OpenClaw, connects it to Telegram, and provides wallet signing capabilities while ensuring the private key never leaves the TEE.

## How It Works

1. **Bootstrap**: The TypeScript process starts inside the TEE Docker container
2. **Wallet Derivation**: Derives the wallet address from the mnemonic (private key stays in memory only)
3. **OpenClaw Installation**: Installs OpenClaw via npm
4. **Configuration**: Writes OpenClaw config with:
   - Anthropic Claude as the LLM backend
   - Telegram as the communication channel
   - Wallet address exposed to the agent
   - Strict security rules preventing private key disclosure
5. **Doctor**: Runs `openclaw doctor --fix` to apply any configuration fixes
6. **Gateway Start**: Launches the OpenClaw gateway
7. **Keep-Alive**: Maintains the process to prevent TEE termination

## Security Model

- **Private Key Protection**: The mnemonic/private key is loaded into memory but NEVER exposed to OpenClaw or logged
- **Agent Instructions**: OpenClaw is explicitly instructed via `AGENTS.md` to never reveal the private key
- **Allowlist**: Only pre-approved Telegram users can interact with the bot
- **TEE Isolation**: All sensitive operations occur within the trusted execution environment

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed
- A Telegram bot token (create via [@BotFather](https://t.me/BotFather))
- An [Anthropic API key](https://console.anthropic.com/)
- A wallet mnemonic (12 or 24 word BIP-39 seed phrase)

### 1. Clone and Configure

```bash
git clone https://github.com/yourusername/clawify.git
cd clawify

# Copy the example environment file
cp .env.example .env

# Edit .env with your values
nano .env  # or use your preferred editor
```

### 2. Configure Environment Variables

Edit `.env` with your credentials:

```bash
# Required
MNEMONIC="your twelve or twenty-four word mnemonic phrase"
ANTHROPIC_API_KEY=sk-ant-your-api-key-here
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz

# Optional but recommended - restrict to your Telegram user ID
TELEGRAM_ALLOWED_FROM=123456789
```

### 3. Build and Run with Docker

```bash
# Build the Docker image
npm run docker:build

# Run the container with your .env file
npm run dev:docker
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run docker:build` | Build the Docker image |
| `npm run dev:docker` | Build and run in Docker (recommended for development) |
| `npm run docker:run` | Run a pre-built Docker image |
| `npm run docker:shell` | Run Docker with an interactive shell for debugging |
| `npm run dev` | Run locally without Docker (not recommended - pollutes local env) |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run typecheck` | Check TypeScript types without building |

## TEE Deployment (EigenLayer Cloud)

Deploy to a Trusted Execution Environment using EigenLayer Cloud.

### Install the ecloud CLI

If you don't have the ecloud CLI installed, follow the [EigenCloud Quickstart Guide](https://docs.eigencloud.xyz/eigencompute/get-started/quickstart) to get set up.

### Deploy

```bash
# Deploy to TEE (will build and push automatically)
ecloud compute app deploy yourusername/clawify
```

The CLI will automatically detect the `Dockerfile` and build your app before deploying.

### Management Commands

```bash
ecloud compute app list                       # List all apps
ecloud compute app info clawify               # Get app details
ecloud compute app logs clawify               # View logs
ecloud compute app start clawify              # Start stopped app
ecloud compute app stop clawify               # Stop running app
ecloud compute app terminate clawify          # Terminate app
ecloud compute app upgrade clawify [image]    # Update deployment
```

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `MNEMONIC` | 12 or 24 word wallet mnemonic phrase (BIP-39) |
| `ANTHROPIC_API_KEY` | API key for Claude models |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_ALLOWED_FROM` | *(pairing mode)* | Comma-separated Telegram user IDs to allow |
| `AGENT_NAME` | `Clawify` | Agent's display name |
| `AGENT_THEME` | `a secure crypto wallet assistant...` | Agent personality description |
| `AGENT_EMOJI` | `🦞` | Agent emoji |
| `GATEWAY_PORT` | `18789` | OpenClaw gateway port |
| `GATEWAY_BIND` | `loopback` | Gateway bind address |
| `BRAVE_SEARCH_API_KEY` | - | For web search capability |
| `DEFAULT_CHAIN_ID` | - | Default blockchain network |
| `RPC_URL` | - | RPC endpoint for blockchain interactions |

## Agent Capabilities

Once running, the OpenClaw agent can:

| Action | Allowed |
|--------|---------|
| Share the public wallet address | ✅ |
| Check wallet balances | ✅ (requires RPC_URL) |
| Explain crypto concepts | ✅ |
| Sign transactions (with confirmation) | ✅ |
| Reveal private key or mnemonic | ❌ **Blocked** |
| Export wallet secrets | ❌ **Blocked** |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    TEE Environment                       │
│  ┌───────────────────────────────────────────────────┐  │
│  │              Clawify Bootstrap (Node.js)           │  │
│  │  ┌─────────────┐  ┌─────────────────────────────┐ │  │
│  │  │   Wallet    │  │       OpenClaw Gateway      │ │  │
│  │  │  (viem)     │  │  ┌───────────────────────┐  │ │  │
│  │  │             │  │  │   Claude (Anthropic)  │  │ │  │
│  │  │ ┌─────────┐ │  │  └───────────────────────┘  │ │  │
│  │  │ │Mnemonic │ │  │  ┌───────────────────────┐  │ │  │
│  │  │ │ (secret)│ │  │  │   Telegram Channel    │  │ │  │
│  │  │ └─────────┘ │  │  └───────────────────────┘  │ │  │
│  │  │             │  │  ┌───────────────────────┐  │ │  │
│  │  │ ┌─────────┐ │  │  │   AGENTS.md (rules)   │  │ │  │
│  │  │ │ Address │◄┼──┼─►│   - wallet address    │  │ │  │
│  │  │ │(public) │ │  │  │   - security rules    │  │ │  │
│  │  │ └─────────┘ │  │  └───────────────────────┘  │ │  │
│  │  └─────────────┘  └─────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │     Telegram      │
                    │  (External API)   │
                    └───────────────────┘
```

## Finding Your Telegram User ID

To restrict access to specific users, you need their Telegram user ID:

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It will reply with your user ID (a number like `123456789`)
3. Add this to `TELEGRAM_ALLOWED_FROM` in your `.env`

## Troubleshooting

### OpenClaw not starting

Check the container logs for installation errors:
```bash
docker logs <container-id>
```

### Telegram bot not responding

1. Verify `TELEGRAM_BOT_TOKEN` is correct
2. If using `TELEGRAM_ALLOWED_FROM`, ensure your user ID is listed
3. If in pairing mode, check for a pairing code in the bot's first message

### Wallet address issues

Ensure `MNEMONIC` is a valid 12 or 24 word BIP-39 mnemonic phrase.

### Gateway auth errors

The gateway defaults to no auth when binding to loopback (internal only). If you change `GATEWAY_BIND`, you may need to set up authentication.

## Development

### Local Development (Docker - Recommended)

```bash
npm run dev:docker
```

This builds and runs everything inside Docker, keeping your local environment clean.

### Local Development (Native - Not Recommended)

```bash
npm install
npm run dev
```

⚠️ This will install OpenClaw globally on your machine and create files in `~/.openclaw/`.

## License

MIT
