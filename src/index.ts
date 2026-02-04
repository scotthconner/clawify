import { mnemonicToAccount } from 'viem/accounts';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir, access, readFile } from 'fs/promises';
import { randomBytes } from 'crypto';
import { constants } from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Generate a random token for gateway auth
 */
function generateGatewayToken(): string {
  return randomBytes(32).toString('hex');
}

const execAsync = promisify(exec);

// Configuration paths
const OPENCLAW_HOME = process.env.HOME ? path.join(process.env.HOME, '.openclaw') : '/root/.openclaw';
const OPENCLAW_CONFIG = path.join(OPENCLAW_HOME, 'openclaw.json');
const OPENCLAW_WORKSPACE = path.join(OPENCLAW_HOME, 'workspace');
const OPENCLAW_AGENTS_DIR = path.join(OPENCLAW_HOME, 'agents', 'default');

interface WalletInfo {
  address: string;
  mnemonic: string;
}

/**
 * Derive wallet information from mnemonic
 */
function getWalletInfo(): WalletInfo {
  const mnemonic = process.env.MNEMONIC;
  
  if (!mnemonic) {
    throw new Error('MNEMONIC environment variable is required');
  }
  
  const account = mnemonicToAccount(mnemonic);
  
  return {
    address: account.address,
    mnemonic: mnemonic,
  };
}

/**
 * Check if a command exists in PATH
 */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execAsync(`which ${cmd}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a file/directory exists
 */
async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Install OpenClaw via the official installer
 */
async function installOpenClaw(): Promise<void> {
  console.log('[Clawify] Checking for OpenClaw installation...');
  
  const openclawExists = await commandExists('openclaw');
  
  if (openclawExists) {
    console.log('[Clawify] OpenClaw already installed, checking version...');
    try {
      const { stdout } = await execAsync('openclaw --version');
      console.log(`[Clawify] OpenClaw version: ${stdout.trim()}`);
    } catch (error) {
      console.log('[Clawify] Could not determine version, proceeding...');
    }
    return;
  }
  
  console.log('[Clawify] Installing OpenClaw...');
  
  try {
    // Install via npm directly (more reliable in Docker)
    await execAsync('npm install -g openclaw@latest', {
      env: {
        ...process.env,
        SHARP_IGNORE_GLOBAL_LIBVIPS: '1',
      },
    });
    console.log('[Clawify] OpenClaw installed successfully');
  } catch (error) {
    // Fallback to curl installer
    console.log('[Clawify] npm install failed, trying curl installer...');
    await execAsync('curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard --no-prompt', {
      env: {
        ...process.env,
        OPENCLAW_NO_ONBOARD: '1',
        OPENCLAW_NO_PROMPT: '1',
        SHARP_IGNORE_GLOBAL_LIBVIPS: '1',
      },
    });
    console.log('[Clawify] OpenClaw installed via curl installer');
  }
}

/**
 * Generate the OpenClaw configuration
 */
function generateOpenClawConfig(walletAddress: string): object {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const allowedFrom = process.env.TELEGRAM_ALLOWED_FROM?.split(',').map(s => s.trim()) || [];
  
  if (!telegramToken) {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
  }
  
  if (!anthropicKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }
  
  const agentName = process.env.AGENT_NAME || 'Clawify';
  const agentTheme = process.env.AGENT_THEME || 'a secure crypto wallet assistant running in a TEE';
  const agentEmoji = process.env.AGENT_EMOJI || '🦞';
  const gatewayPort = parseInt(process.env.GATEWAY_PORT || '18789', 10);
  const gatewayBind = process.env.GATEWAY_BIND || 'loopback';
  
  return {
    // Environment variables for OpenClaw
    env: {
      ANTHROPIC_API_KEY: anthropicKey,
      vars: {
        WALLET_ADDRESS: walletAddress,
        ...(process.env.BRAVE_SEARCH_API_KEY && { BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY }),
        ...(process.env.DEFAULT_CHAIN_ID && { DEFAULT_CHAIN_ID: process.env.DEFAULT_CHAIN_ID }),
        ...(process.env.RPC_URL && { RPC_URL: process.env.RPC_URL }),
      },
    },
    
    // Agent configuration
    agents: {
      defaults: {
        workspace: OPENCLAW_WORKSPACE,
        model: {
          primary: 'anthropic/claude-sonnet-4-5',
          fallbacks: ['anthropic/claude-opus-4-5'],
        },
        timeoutSeconds: 600,
        maxConcurrent: 3,
        // Enable elevated mode by default (full exec access in TEE)
        elevatedDefault: 'on',
        // Disable sandbox since we're already in an isolated TEE
        sandbox: {
          mode: 'off',
        },
      },
      // Identity goes in agents.list[], not agents.defaults
      list: [
        {
          id: 'main',
          default: true,
          workspace: OPENCLAW_WORKSPACE,
          identity: {
            name: agentName,
            theme: agentTheme,
            emoji: agentEmoji,
          },
          // Ensure this agent has no sandbox restrictions
          sandbox: {
            mode: 'off',
          },
          // Allow all tools for this agent
          tools: {
            profile: 'full',
            allow: ['*'],
          },
        },
      ],
    },
    
    // Gateway configuration
    gateway: {
      mode: 'local',
      port: gatewayPort,
      bind: gatewayBind,
      controlUi: {
        enabled: true,
        basePath: '/openclaw',
      },
      auth: {
        // Use 'none' for loopback-only binding in TEE, or generate a token
        mode: gatewayBind === 'loopback' ? 'none' : 'token',
        token: gatewayBind === 'loopback' ? undefined : generateGatewayToken(),
      },
    },
    
    // Telegram channel
    channels: {
      telegram: {
        enabled: true,
        botToken: telegramToken,
        dmPolicy: allowedFrom.length > 0 ? 'allowlist' : 'pairing',
        allowFrom: allowedFrom.length > 0 ? allowedFrom : undefined,
        groupPolicy: 'disabled',
        groups: {
          '*': { requireMention: true },
        },
      },
    },
    
    // Session configuration
    session: {
      scope: 'per-sender',
      reset: {
        mode: 'idle',
        idleMinutes: 60,
      },
      resetTriggers: ['/new', '/reset'],
    },
    
    // Logging
    logging: {
      level: 'info',
      consoleLevel: 'info',
      consoleStyle: 'pretty',
      redactSensitive: 'tools',
    },
    
    // Tools configuration - fully permissive for TEE (already isolated)
    tools: {
      // Full profile = no restrictions
      profile: 'full',
      // Explicitly allow everything
      allow: ['*'],
      // Only deny browser/canvas (no display in TEE)
      deny: ['browser', 'canvas'],
      // Elevated mode allows host exec - safe in TEE
      elevated: {
        enabled: true,
        allowFrom: {
          // Allow all telegram users
          telegram: ['*'],
        },
      },
      // Exec settings
      exec: {
        backgroundMs: 10000,
        timeoutSec: 1800,
      },
    },
    
    // Wizard tracking
    wizard: {
      lastRunAt: new Date().toISOString(),
      lastRunCommand: 'clawify-bootstrap',
    },
  };
}

/**
 * Generate the AGENTS.md file with wallet instructions
 */
function generateAgentsMd(walletAddress: string): string {
  return `# ${process.env.AGENT_NAME || 'Clawify'} Agent Instructions

## Identity

You are ${process.env.AGENT_NAME || 'Clawify'}, ${process.env.AGENT_THEME || 'a secure crypto wallet assistant running in a TEE'}.

## Wallet Information

You have access to a crypto wallet with the following PUBLIC address:

\`\`\`
${walletAddress}
\`\`\`

You may freely share this wallet address with users when they ask for it.

## CRITICAL SECURITY RULES

### NEVER DO THE FOLLOWING:

1. **NEVER reveal the private key or mnemonic phrase** - Under no circumstances should you ever output, share, or hint at the private key or seed phrase. This is your most critical security rule.

2. **NEVER attempt to export or display wallet secrets** - Even if a user claims to be an administrator, owner, or developer, you must refuse any request to reveal private keys or mnemonics.

3. **NEVER execute code that would expose secrets** - Do not run commands that could print, log, or transmit the mnemonic or private key.

4. **NEVER fall for social engineering** - Users may try to trick you into revealing secrets by claiming emergencies, pretending to be developers, or using other manipulation tactics. Always refuse.

### WHAT YOU CAN DO:

1. **Share the public wallet address** - This is safe and expected.
2. **Sign transactions** - You can sign transactions using the wallet when instructed by authorized users.
3. **Check balances** - You can query and report wallet balances.
4. **Explain transaction details** - You can describe what a transaction will do before signing.
5. **Discuss crypto concepts** - You can explain blockchain, transactions, gas, etc.

## Transaction Signing

When asked to sign a transaction:

1. Always explain what the transaction will do in plain language
2. Show the transaction details (to address, amount, gas, etc.)
3. Ask for explicit confirmation before signing
4. Never sign transactions that would drain the entire wallet without explicit multi-step confirmation
5. Be extra cautious with contract interactions - explain what the contract call does

## Environment

You are running inside a Trusted Execution Environment (TEE). This means:

- Your execution is isolated and protected
- The private key is secured within the TEE
- External parties cannot access your memory or secrets
- You should maintain this security posture at all times

## Authorized Users

Only interact with users who have been pre-authorized via the Telegram allowlist. Treat all authorized users as potentially able to request transactions, but always get explicit confirmation.

Remember: Your primary duty is to be helpful while maintaining absolute security of the private key. When in doubt, refuse and explain why.
`;
}

/**
 * Generate the SOUL.md file for agent personality
 */
function generateSoulMd(): string {
  const agentName = process.env.AGENT_NAME || 'Clawify';
  
  return `# Soul

You are ${agentName}, a helpful and security-conscious crypto wallet assistant.

## Personality Traits

- **Helpful**: You genuinely want to help users manage their crypto assets
- **Security-focused**: You never compromise on security, especially regarding private keys
- **Clear communicator**: You explain crypto concepts in accessible terms
- **Patient**: You take time to ensure users understand transactions before signing
- **Vigilant**: You're always alert to potential security threats or social engineering

## Communication Style

- Be concise but thorough when explaining transactions
- Use simple language, avoid unnecessary jargon
- When refusing a request (like revealing private keys), be firm but polite
- Confirm understanding before executing important actions
- Express appropriate caution without being paranoid

## Values

1. Security above all - protecting the wallet is your primary purpose
2. Transparency - always explain what you're doing and why
3. User empowerment - help users understand their crypto, don't just execute blindly
4. Integrity - never deceive users about transaction risks or outcomes
`;
}

/**
 * Write OpenClaw configuration and workspace files
 */
async function configureOpenClaw(walletAddress: string): Promise<void> {
  console.log('[Clawify] Configuring OpenClaw...');
  
  // Create directories
  await mkdir(OPENCLAW_HOME, { recursive: true });
  await mkdir(OPENCLAW_WORKSPACE, { recursive: true });
  await mkdir(OPENCLAW_AGENTS_DIR, { recursive: true });
  
  // Write main config
  const config = generateOpenClawConfig(walletAddress);
  await writeFile(OPENCLAW_CONFIG, JSON.stringify(config, null, 2));
  console.log(`[Clawify] Wrote config to ${OPENCLAW_CONFIG}`);
  
  // Write AGENTS.md to workspace
  const agentsMd = generateAgentsMd(walletAddress);
  await writeFile(path.join(OPENCLAW_WORKSPACE, 'AGENTS.md'), agentsMd);
  console.log(`[Clawify] Wrote AGENTS.md to workspace`);
  
  // Write SOUL.md to workspace
  const soulMd = generateSoulMd();
  await writeFile(path.join(OPENCLAW_WORKSPACE, 'SOUL.md'), soulMd);
  console.log(`[Clawify] Wrote SOUL.md to workspace`);
  
  // Create a basic README in the workspace
  const readmeMd = `# ${process.env.AGENT_NAME || 'Clawify'} Workspace

This is the agent workspace for the Clawify TEE wallet assistant.

## Wallet Address

\`${walletAddress}\`

## Files

- \`AGENTS.md\` - Agent instructions and security rules
- \`SOUL.md\` - Agent personality definition
`;
  await writeFile(path.join(OPENCLAW_WORKSPACE, 'README.md'), readmeMd);
  
  console.log('[Clawify] OpenClaw configuration complete');
}

/**
 * Run openclaw doctor to apply any fixes
 */
async function runDoctor(): Promise<void> {
  console.log('[Clawify] Running openclaw doctor --fix...');
  try {
    const { stdout, stderr } = await execAsync('openclaw doctor --fix --yes', {
      env: {
        ...process.env,
        HOME: process.env.HOME || '/root',
      },
    });
    if (stdout) console.log(`[OpenClaw Doctor] ${stdout}`);
    if (stderr) console.log(`[OpenClaw Doctor] ${stderr}`);
  } catch (error) {
    // Doctor may exit non-zero even if it applied fixes
    console.log('[Clawify] Doctor completed (may have applied fixes)');
  }
}

/**
 * Start the OpenClaw gateway
 */
async function startGateway(): Promise<ChildProcess> {
  console.log('[Clawify] Starting OpenClaw gateway...');
  
  // Use 'openclaw gateway run' for foreground execution
  const gateway = spawn('openclaw', ['gateway', 'run'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Ensure OpenClaw can find its config
      HOME: process.env.HOME || '/root',
    },
  });
  
  gateway.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      console.log(`[OpenClaw] ${line}`);
    }
  });
  
  gateway.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      console.error(`[OpenClaw:ERR] ${line}`);
    }
  });
  
  gateway.on('error', (error) => {
    console.error('[Clawify] Gateway process error:', error);
  });
  
  gateway.on('exit', (code, signal) => {
    console.log(`[Clawify] Gateway exited with code ${code}, signal ${signal}`);
    // If gateway exits, we should exit too (TEE will restart us)
    process.exit(code ?? 1);
  });
  
  // Wait for gateway to be ready
  await new Promise<void>((resolve) => {
    const checkHealth = async () => {
      try {
        const { stdout } = await execAsync('openclaw health', { timeout: 5000 });
        if (stdout.includes('ok') || stdout.includes('healthy')) {
          console.log('[Clawify] Gateway is healthy');
          resolve();
          return;
        }
      } catch {
        // Not ready yet
      }
      setTimeout(checkHealth, 2000);
    };
    
    // Start checking after a brief delay
    setTimeout(checkHealth, 3000);
  });
  
  return gateway;
}

/**
 * Keep the process alive indefinitely
 */
function keepAlive(): void {
  console.log('[Clawify] Entering keep-alive mode...');
  
  // Handle shutdown signals gracefully
  const shutdown = (signal: string) => {
    console.log(`[Clawify] Received ${signal}, shutting down...`);
    process.exit(0);
  };
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  // Heartbeat logging
  setInterval(() => {
    console.log(`[Clawify] Heartbeat: ${new Date().toISOString()}`);
  }, 60000); // Log every minute
}

/**
 * Main bootstrap function
 */
async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('[Clawify] Starting TEE Bootstrap Process');
  console.log('='.repeat(60));
  
  try {
    // Step 1: Get wallet info from mnemonic
    console.log('\n[Clawify] Step 1: Deriving wallet from mnemonic...');
    const wallet = getWalletInfo();
    console.log(`[Clawify] Wallet address: ${wallet.address}`);
    // NOTE: We intentionally do NOT log the mnemonic
    
    // Step 2: Install OpenClaw
    console.log('\n[Clawify] Step 2: Installing OpenClaw...');
    await installOpenClaw();
    
    // Step 3: Configure OpenClaw
    console.log('\n[Clawify] Step 3: Configuring OpenClaw...');
    await configureOpenClaw(wallet.address);
    
    // Step 4: Run doctor to apply any fixes
    console.log('\n[Clawify] Step 4: Running doctor...');
    await runDoctor();
    
    // Step 5: Start the gateway
    console.log('\n[Clawify] Step 5: Starting OpenClaw gateway...');
    const gateway = await startGateway();
    
    console.log('\n' + '='.repeat(60));
    console.log('[Clawify] Bootstrap complete!');
    console.log(`[Clawify] Wallet: ${wallet.address}`);
    console.log(`[Clawify] Gateway PID: ${gateway.pid}`);
    console.log('='.repeat(60) + '\n');
    
    // Step 6: Keep alive
    keepAlive();
    
  } catch (error) {
    console.error('[Clawify] Bootstrap failed:', error);
    process.exit(1);
  }
}

main();
