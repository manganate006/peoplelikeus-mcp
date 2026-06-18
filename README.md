<a name="english"></a>

---

[English](#english) &nbsp;|&nbsp; [Français](#français)

---

# PeopleLikeUs MCP Server

![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.26%2B-purple)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

A **Model Context Protocol (MCP)** server for interacting with the [PeopleLikeUs](https://www.peoplelikeus.world) home exchange platform directly from your AI assistant.

Browse properties, manage conversations, update your availability calendar, track exchanges — all with natural language.

---

## Features

- **28 MCP tools** covering read and write operations
- Search properties by country, location, dates
- Messaging: read conversations, send messages, delete threads
- Calendar management: add/remove availability and unavailability periods
- Exchange tracking: create, update dates/type, cancel
- **Auto-login** with email/password — no manual token extraction needed
- Session cache (`~/.peoplelikeus-mcp-session.json`, 1h TTL)
- CSRF protection handled automatically
- Rate limiting with configurable delay between requests

---

## Quick Start

```bash
git clone https://github.com/manganate006/peoplelikeus-mcp
cd peoplelikeus-mcp
npm install && npm run build
```

---

## Authentication

PeopleLikeUs uses standard Laravel session authentication — **no CAPTCHA, no Auth0**. Automated login works out of the box.

### Option 1 — Auto-login (recommended)

Set `PLU_EMAIL` and `PLU_PASSWORD` in your config.

### Option 2 — Browser cookies

Copy `laravel_session` + `XSRF-TOKEN` from DevTools → Cookies.

### Option 3 — Runtime login

Call `plu_login` with your email and password.

| Priority | Method | Description |
|----------|--------|-------------|
| 1 | `PLU_EMAIL` + `PLU_PASSWORD` | Auto-login (recommended) |
| 2 | `PLU_COOKIES` env var | Raw cookie string from DevTools |
| 3 | Disk cache | `~/.peoplelikeus-mcp-session.json` (1h TTL) |
| 4 | Runtime | Call `plu_login` or `plu_set_cookies` tool |

---

## Configuration

```json
{
  "mcpServers": {
    "peoplelikeus": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/peoplelikeus-mcp/dist/index.js"],
      "env": {
        "PLU_EMAIL": "your@email.com",
        "PLU_PASSWORD": "yourpassword"
      }
    }
  }
}
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PLU_EMAIL` | No* | — | Login email |
| `PLU_PASSWORD` | No* | — | Login password |
| `PLU_COOKIES` | No* | — | Raw cookie string |
| `PLU_REQUEST_DELAY` | No | `1000` | Delay between requests (ms) |

---

## Tools (28)

### Auth (3)
| Tool | Description |
|------|-------------|
| `plu_auth_status` | Check authentication status |
| `plu_login` | Login with credentials |
| `plu_set_cookies` | Inject raw browser cookies |

### Properties (2)
| Tool | Description |
|------|-------------|
| `plu_get_property` | Property details (public page) |
| `plu_get_my_properties` | List your own properties |

### Calendar (6)
| Tool | Description |
|------|-------------|
| `plu_get_availabilities` | Get availability periods (JSON API) |
| `plu_get_unavailabilities` | Get unavailability periods (JSON API) |
| `plu_add_availability` | Add an availability period |
| `plu_delete_availability` | Delete an availability period |
| `plu_add_unavailability` | Add an unavailability period |
| `plu_delete_unavailability` | Delete an unavailability period |

### Conversations & Messages (5)
| Tool | Description |
|------|-------------|
| `plu_get_conversations` | List conversations |
| `plu_get_messages` | Get messages in a thread |
| `plu_send_message` | Send a message |
| `plu_delete_message` | Delete a message |
| `plu_delete_conversation` | Delete/trash a conversation |

### Exchanges (6)
| Tool | Description |
|------|-------------|
| `plu_get_exchanges` | List your exchanges |
| `plu_get_exchange` | Exchange details |
| `plu_create_exchange` | Propose a new exchange |
| `plu_update_exchange_dates` | Update exchange dates |
| `plu_update_exchange_type` | Change exchange type |
| `plu_cancel_exchange` | Cancel an exchange |

### Search (2)
| Tool | Description |
|------|-------------|
| `plu_search_homes` | Search properties |
| `plu_quick_search` | Search by listing number |

### Misc (2)
| Tool | Description |
|------|-------------|
| `plu_get_notifications` | Get notifications |
| `plu_get_auth_user` | Get authenticated user info |

---

## Architecture

```
src/
├── index.ts    — Entry point, StdioServerTransport
├── server.ts   — 28 MCP tool definitions + request dispatch
├── api.ts      — HTTP client (JSON API + HTML parsing)
├── auth.ts     — Laravel session auth (login, CSRF, cookies, cache)
└── types.ts    — TypeScript interfaces
```

**Dual API approach:**
- **JSON API**: `/api/availables`, `/api/unavailables`, `/notifications`, `/authuser`
- **HTML parsing**: conversations, exchanges, properties, search (Laravel Blade)

---

## License

MIT
