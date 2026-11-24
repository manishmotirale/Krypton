<div align="center">

<img src="./krypton.png" alt="KRYPTON Logo" width="180"/>

# 🚀 KRYPTON

### *Think. Act. Automate.*

<p align="center">
  <a href="#-what-is-krypton">About</a> •
  <a href="#-features">Features</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-modes">Modes</a> •
  <a href="#-whatsapp-bot-mode">WhatsApp Bot</a> •
  <a href="#-telegram-bot-mode">Telegram Bot</a> •
  <a href="#-project-structure">Structure</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-blue?style=for-the-badge" alt="Version"/>
  <img src="https://img.shields.io/badge/Bun-1.4.2%2B-black?style=for-the-badge&logo=bun&logoColor=white" alt="Bun"/>
  <img src="https://img.shields.io/badge/TypeScript-Strict-blue?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/WhatsApp-Bot-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="WhatsApp"/>
  <img src="https://img.shields.io/badge/Telegram-Bot-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram"/>
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License"/>
</p>

</div>

---

## 🎯 What is KRYPTON?

**KRYPTON** is your **all-in-one personal AI assistant and automation bot** — accessible right from your terminal, **WhatsApp**, or **Telegram**.

Use KRYPTON for anything you need done:
- 💬 **Everyday AI Assistant** — ask any question, brainstorm, write emails/documents/notes, summarize content, and learn topics
- 🌐 **Live Web Research** — search the web and read/scrape web pages automatically (via Firecrawl)
- 🤖 **Autonomous Task Execution (Agent Mode)** — create, organize, and edit local files, documents, notes, scripts, or projects, and run shell automation commands — always with preview & approval first
- 📋 **Goal Planning (Plan Mode)** — break any big goal (personal, work, research, or technical) into selectable steps and execute them in order
- 💚 **WhatsApp Bot** — chat with KRYPTON from your phone in your own dedicated **KRYPTON** WhatsApp chat (no paid API or server needed)
- 💬 **Telegram Bot** — chat naturally or run commands with inline approval buttons from Telegram
- ↩️ **Undo Safety Net** — automatic backups before every applied change (`bun run undo` or `/undo`)
- 🧩 **Custom Skills & Developer Tools** — load reusable `SKILL.md` playbooks, inspect Git repos, search files, and handle coding tasks whenever needed

KRYPTON is built around an **approval-first workflow**: it never modifies files or runs commands on your computer until you preview and approve them.

---

## ✨ Features

<table>
<tr>
<td width="50%" valign="top">

### 💬 Ask Mode (General & Workspace Q&A)

Read-only conversational AI assistant.

- Answer general questions, write, summarize, and brainstorm
- Search the live web and scrape pages (with Firecrawl)
- Multi-turn follow-up conversation with retained context
- Read & search local files, notes, folders, and Git repos
- Load custom Cursor / Claude `SKILL.md` playbooks
- Save your entire Q&A conversation to a `.md` document

</td>
<td width="50%" valign="top">

### 🤖 Agent Mode (Act & Automate)

Execute real tasks on your machine safely.

- Create, edit (`edit_file` / `modify_file`), and delete files
- Create folders and organize local directories
- Queue shell/terminal commands with captured output
- Preview a full staged summary and unified diffs before applying
- Approve all, review one by one, or reject everything
- Automatic snapshot backup for one-command **Undo**

</td>
</tr>

<tr>
<td width="50%" valign="top">

### 📋 Plan Mode (Think Then Execute)

Turn big goals into clear, actionable steps.

- Researches your files and the web before planning
- Produces 1–15 ordered steps with complexity tags (`low` / `medium` / `high`)
- Pick exactly which steps to run (CLI, WhatsApp, or Telegram)
- Live step-by-step execution progress
- Single unified diff review and approval at the end

</td>
<td width="50%" valign="top">

### 💚 WhatsApp & 💬 Telegram Bots

Use KRYPTON remotely from your phone like a personal AI bot.

- **WhatsApp Multi-Device** via Baileys — link in 30 seconds with QR code or 8-digit pairing code
- **Dedicated `"KRYPTON"` WhatsApp Chat** via `/bind` — just type normally without `/` prefixes!
- **Telegram Natural Chat + Inline Buttons** — message directly or use `/agent`, `/plan`, `/undo`, `/model`
- Owner-only security (blocks unauthorized numbers and random groups)
- Automatic message chunking for long replies and diffs

</td>
</tr>
</table>

### 🔒 Safety First

- **Approval Workflow** — every file write, delete, folder create, and shell command requires explicit approval
- **Automatic Undo Snapshots** — saved locally in `.krypton/undo/` before applying changes
- **Path & Secret Protection** — blocks directory escapes (`../`) and protects `.env*`, `.git`, `.krypton`, `node_modules`, and `*.log`
- **Strict Bot Authorization** — Telegram owner-ID lock; WhatsApp only listens to your bound **KRYPTON** chat, your **Message Yourself** chat, or numbers in `WHATSAPP_ALLOWED_NUMBERS`

---

## 🧰 Tech Stack

| Area | Technology |
|---|---|
| Runtime | [Bun](https://bun.sh/) v1.4.2+ |
| Language | [TypeScript](https://www.typescriptlang.org/) (strict mode) |
| AI / LLM Gateway | [OpenRouter](https://openrouter.ai/) via [Vercel AI SDK](https://sdk.vercel.ai/) |
| WhatsApp Bot | [Baileys](https://github.com/WhiskeySockets/Baileys) + `qrcode-terminal` |
| Telegram Bot | [Telegraf](https://telegraf.js.org/) |
| Web Research | [Firecrawl](https://firecrawl.dev/) |
| CLI & Prompts | [Commander](https://github.com/tj/commander.js) & [Clack](https://github.com/natemoo-re/clack) |
| Validation & Diffs | [Zod](https://zod.dev/), `diff`, Chalk, Figlet, Marked Terminal |
| Testing | `bun:test` |

---

# 🚀 Quick Start

```bash
bun install
cp .env.example .env
# Add your OPENROUTER_API_KEY in .env
bun run doctor
bun wakeup
```

### Interactive Launch Menu

```text
██╗  ██╗██████╗ ██╗   ██╗██████╗ ████████╗ ██████╗ ███╗   ██╗
██║ ██╔╝██╔══██╗╚██╗ ██╔╝██╔══██╗╚══██╔══╝██╔═══██╗████╗  ██║
█████╔╝ ██████╔╝ ╚████╔╝ ██████╔╝   ██║   ██║   ██║██╔██╗ ██║
██╔═██╗ ██╔══██╗  ╚██╔╝  ██╔═══╝    ██║   ██║   ██║██║╚██╗██║
██║  ██╗██║  ██║   ██║   ██║        ██║   ╚██████╔╝██║ ╚████║
╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝        ╚═╝    ╚═════╝ ╚═╝  ╚═══╝
  v2.0.0 — Think. Act. Automate.

◆ Which mode do you want to use?
● 🤖 AI Mode (CLI) (Agent, Plan, and Ask modes)
○ 💚 WhatsApp Mode (Bot) (Chat & automate remotely from WhatsApp)
○ 💬 Telegram Mode (Bot) (Chat & automate remotely from Telegram)
○ 🩺 System Diagnostics (Check API keys, sessions & workspace)
○ ↩️  Undo Last Changes (Revert last applied agent batch)
○ 🚪 Exit
```

---

# 📦 Installation

## Prerequisites

- [Bun](https://bun.sh/) **v1.4.2+**
- An [OpenRouter API key](https://openrouter.ai/) *(supports free & paid models like `openrouter/free`, `openrouter/auto`, Claude, Gemini, GPT)*
- *(Optional)* [Firecrawl API key](https://firecrawl.dev/) for live web search & scraping
- *(Optional)* WhatsApp on your phone — no API key needed
- *(Optional)* Telegram Bot Token + Owner ID from `@BotFather` & `@userinfobot`

## Setup

```bash
git clone <repository-url>
cd krypton
bun install
cp .env.example .env
```

Edit `.env` and verify with:

```bash
bun run doctor
```

> **Security:** Never commit `.env` or `.krypton/`. Both are ignored in `.gitignore`.

---

# 🎮 CLI Commands

| Command | Description |
|---|---|
| `bun wakeup` / `bun start` | Open the interactive KRYPTON menu |
| `bun run src/index.ts ask [prompt]` | Start Ask Mode (chat, research, write, or inspect files) |
| `bun run src/index.ts agent [task]` | Start Agent Mode directly |
| `bun run src/index.ts plan [goal]` | Start Plan Mode directly |
| `bun run whatsapp` | Launch WhatsApp Bot |
| `bun run src/index.ts whatsapp --reset-auth` | Reset saved WhatsApp login and scan a new QR |
| `bun run telegram` | Launch Telegram Bot |
| `bun run doctor` | Check API keys, model, WhatsApp/Telegram status & undo count |
| `bun run undo` | Undo the last applied file-change batch (`--yes` skips prompt) |
| `bun test` | Run automated unit tests |
| `bun run lint` | TypeScript strict type-check |
| `bun run build` / `bun run build:exe` | Bundle or compile standalone Windows `.exe` |

### One-Click Launch on Windows

Double-click **`KRYPTON.bat`** in the project root (or **`dist/krypton.exe`** directly) to open CMD straight onto the KRYPTON wake-up menu.
To rebuild `dist/krypton.exe` after making code changes, run `.\scripts\build-exe.ps1`.

---

# 💚 WhatsApp Bot Mode

Control KRYPTON from WhatsApp with **no paid API, no webhooks, and no cloud server**.

### Step-by-Step Setup

1. **Start the bot on your computer:**
   ```bash
   bun run whatsapp
   ```
2. **Link your phone (first time only):**
   - On your phone, open **WhatsApp → Settings → Linked Devices → Link a Device** and scan the QR code shown in your terminal.
   - *(Alternative)* Set `WHATSAPP_PAIRING_PHONE=919876543210` in `.env` to link with an **8-digit pairing code** instead of a QR scan.
   - Your login is saved in `.krypton/whatsapp-auth/` — next time you run `bun run whatsapp`, it connects automatically.
3. **Choose where to chat with KRYPTON:**
   - **Recommended — Dedicated `"KRYPTON"` Chat:**
     1. In WhatsApp, create a **New Group**, add any 1 contact temporarily, name the group **KRYPTON**, then remove that contact so only you are inside.
     2. Send `/bind` inside that **KRYPTON** group.
     3. Pin the **KRYPTON** chat to the top of WhatsApp! Now you can just type normally (e.g. `Write a meeting agenda` or `/agent Create notes.md`) and KRYPTON replies right inside that chat.
   - **Instant Option — "Message Yourself" Chat:**
     - Open your own `(You)` chat in WhatsApp (KRYPTON automatically sends its welcome message there) and send commands starting with `/` or `!` (e.g. `/ask ...`, `/agent ...`, `/plan ...`).
   - **Optional — Separate Bot Phone Number:**
     - Link a spare WhatsApp / WhatsApp Business phone (`--reset-auth`), add your main number to `WHATSAPP_ALLOWED_NUMBERS` in `.env`, save that number as **KRYPTON**, and message it directly.

### WhatsApp Commands

| Command | What It Does |
|---|---|
| *(plain text in bound KRYPTON chat)* | Chat directly with KRYPTON about anything |
| `/ask <anything>` or `/chat <anything>` | Ask questions, write, summarize, search the web, or read files |
| `/agent <task>` | Perform tasks, create/edit files, or run commands (staged for approval) |
| `/plan <goal>` | Draft a step-by-step plan and pick steps to run |
| `diff` • `approve` • `reject` | Review, apply, or discard staged changes |
| `toggle 1,3` • `all` • `none` • `proceed` | Select and run steps in an active plan |
| `/bind` / `/unbind` | Make a WhatsApp group your dedicated KRYPTON chat (or unbind it) |
| `/undo` | Revert the last applied file-change batch |
| `/model [id \| reset]` | View or switch the active OpenRouter model |
| `/git` | Quick Git status & recent commits |
| `/status` | Show active model, workspace, undo snapshots & sessions |
| `/cancel` | Cancel any active plan or approval session |
| `/help` | Show all commands |

---

# 💬 Telegram Bot Mode

1. Get `TELEGRAM_BOT_TOKEN` from [@BotFather](https://t.me/BotFather) and `TELEGRAM_OWNER_ID` from [@userinfobot](https://t.me/userinfobot).
2. Add both to `.env` and run `bun run telegram`.
3. **Just send any message directly** to chat with KRYPTON, or use `/ask`, `/agent`, `/plan`, `/undo`, `/model`, `/git`, `/status`, `/cancel`, `/help`.

---

# 🔐 Environment Variables

| Variable | Required | Default | Purpose |
|---|:---:|---|---|
| `OPENROUTER_API_KEY` | ✅ | — | OpenRouter API key |
| `OPENROUTER_DEFAULT_MODEL` | ⚠️ | `openrouter/auto` | Default OpenRouter model ID |
| `FIRECRAWL_API_KEY` | ⚠️ | — | Enables live `web_search` and `web_crawl` |
| `WHATSAPP_ALLOW_SELF_CHAT` | ⚠️ | `true` | Allow commands in WhatsApp "Message Yourself" |
| `WHATSAPP_ALLOWED_NUMBERS` | ⚠️ | — | Comma-separated international numbers allowed to message the bot |
| `WHATSAPP_PAIRING_PHONE` | ⚠️ | — | Optional digits-only phone number for 8-digit pairing code login |
| `WHATSAPP_AUTH_DIR` | ⚠️ | `.krypton/whatsapp-auth` | Folder storing WhatsApp multi-device session |
| `TELEGRAM_BOT_TOKEN` | ⚠️ | — | Telegram bot token |
| `TELEGRAM_OWNER_ID` | ⚠️ | — | Authorized Telegram owner ID |
| `SKILLS_DIRS` | ⚠️ | `~/.cursor/skills-cursor`, `~/.claude/skills` | Extra semicolon-separated `SKILL.md` directories |
| `LOG_LEVEL` | ⚠️ | `INFO` | Logging verbosity (`DEBUG`, `INFO`, `WARN`, `ERROR`) |

---

# 📁 Project Structure

```text
krypton/
├── KRYPTON.bat                     # One-click Windows launcher
├── .env.example                    # Environment template
├── .gitignore                      # Ignores .env, .krypton/, dist/
├── package.json                    # Dependencies and scripts
├── tsconfig.json                   # Strict TypeScript config
├── krypton.png                     # Logo
├── docs/
│   └── ARCHITECTURE.md             # System architecture
├── scripts/
│   └── build-exe.ps1               # Windows standalone EXE builder (dist/krypton.exe)
├── tests/
│   ├── tool-executor.test.ts       # ToolExecutor, security, git & Undo tests
│   ├── whatsapp.test.ts            # WhatsApp auth, binding & handler tests
│   └── shared-and-telegram.test.ts # Shared runner & Telegram tests
└── src/
    ├── index.ts                    # Commander CLI entry point
    ├── config/
    │   └── env.ts                  # Env config, model switching & diagnostics
    ├── core/ai/
    │   └── ai.config.ts            # OpenRouter provider factory
    ├── lib/
    │   ├── error-handler.ts        # KryptonError & safe wrappers
    │   ├── logger.ts               # Structured colored logger
    │   └── version.ts              # App version & metadata
    ├── ui/
    │   ├── wakeup.ts               # Banner & main menu loop
    │   └── terminal-md.ts          # Terminal Markdown renderer
    └── modes/
        ├── cli.ts                  # Interactive AI Mode menu
        ├── doctor.ts               # Diagnostics, Undo & Model Switch CLI
        ├── shared/
        │   └── bot-runner.ts       # Shared AI runners, chunking & diff formatters
        ├── agent/
        │   ├── orchestrator.ts     # Agent Mode loop
        │   ├── agent-tools.ts      # Action + read-only tools
        │   ├── read-only-tools.ts  # Shared read-only, Git & skill tools
        │   ├── tool-executor.ts    # Safe filesystem, search, git & shell executor
        │   ├── action-tracker.ts   # Mutation audit log
        │   ├── undo-manager.ts     # Automatic snapshot backup & rollback
        │   ├── approval.ts         # Staged summary & diff approval flow
        │   ├── diff-view.ts        # Unified diff composition
        │   └── types.ts            # Agent types & config
        ├── ask/
        │   └── orchestrator.ts     # Multi-turn read-only Ask Mode
        ├── plan/
        │   ├── orchestrator.ts     # Step selection & execution orchestrator
        │   ├── planner.ts          # Structured JSON plan generator
        │   ├── selection.ts        # Terminal plan display & picker
        │   ├── web-tools.ts        # Firecrawl web search & scraping
        │   └── types.ts            # Plan types
        ├── telegram/
        │   ├── index.ts            # Telegraf launcher
        │   ├── handlers.ts         # Natural chat, commands & inline buttons
        │   ├── auth.ts             # Owner authorization
        │   ├── agent-run.ts        # Telegram Ask/Agent/Plan runners
        │   ├── approval-session.ts # Inline approval session
        │   ├── plan-session.ts     # Interactive step-toggle session
        │   ├── constants.ts        # Welcome & help menu
        │   └── text.ts             # Safe chunked Markdown replies
        └── whatsapp/
            ├── index.ts            # Baileys socket, QR/pairing, /bind & reconnect
            ├── handlers.ts         # Natural chat, commands & interactive sessions
            ├── auth.ts             # Self-chat, bound group, allowlist & loop guard
            ├── session.ts          # Plan & approval session state
            ├── constants.ts        # WhatsApp welcome & help menu
            └── text.ts             # Message extraction & WhatsApp formatting
```

---

# 🧪 Testing & Verification

```bash
bun test       # Run all unit tests
bun run lint   # Strict TypeScript check
bun run doctor # Verify API keys, model & bot readiness
```

---

# 🐛 Troubleshooting

| Issue | Solution |
|---|---|
| `OPENROUTER_API_KEY` missing | Copy `.env.example` to `.env`, add your key, and check with `bun run doctor` |
| WhatsApp shows "Try again" on QR scan | Run `bun run src/index.ts whatsapp --reset-auth` directly in your terminal and scan the fresh QR within 30 seconds |
| Not sure where to chat on WhatsApp | Either open your own `(You)` "Message Yourself" chat, OR create a private **KRYPTON** WhatsApp group and send `/bind` inside it |
| Need to revert applied file changes | Run `bun run undo` (or send `/undo` on WhatsApp / Telegram) |
| Telegram bot not replying | Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OWNER_ID` via `bun run doctor` |

---

# 📜 License

Licensed under the **MIT License**. See [`LICENSE`](./LICENSE) for details.

<div align="center">

### **Think. Act. Automate. 🚀**

</div>
