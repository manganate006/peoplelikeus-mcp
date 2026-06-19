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
- Rate limiting with configurable delay + automatic retry/backoff on HTTP 429

---

## Prerequisites

- **Node.js** >= 18
- A **PeopleLikeUs** account (Premium recommended)
- A **MCP-compatible client**: any host supporting the Model Context Protocol

---

## Quick Start

```bash
# 1. Clone and build
git clone https://github.com/your-username/peoplelikeus-mcp
cd peoplelikeus-mcp
npm install && npm run build

# 2. Add to your MCP client config (see Configuration below)
```

---

## Authentication

PeopleLikeUs uses standard Laravel session authentication — **no CAPTCHA, no Auth0**. Automated login works out of the box.

### Option 1 — Auto-login (recommended)

Set `PLU_EMAIL` and `PLU_PASSWORD` in your config. The server handles login, CSRF tokens, and session management automatically.

### Option 2 — Browser cookies

1. Open [peoplelikeus.world](https://www.peoplelikeus.world) and log in
2. Open browser **DevTools** → **Application** → **Cookies**
3. Copy the `laravel_session` and `XSRF-TOKEN` cookie values
4. Set as `PLU_COOKIES` or call `plu_set_cookies` at runtime

> Note: `laravel_session` is httpOnly — it's not visible via `document.cookie`. You must copy it from the DevTools Cookies panel.

### Option 3 — Runtime login

Call `plu_login` with your email and password at runtime.

### Authentication priority

| Priority | Method | Description |
|----------|--------|-------------|
| 1 | `PLU_EMAIL` + `PLU_PASSWORD` | Auto-login (recommended) |
| 2 | `PLU_COOKIES` env var | Raw cookie string from DevTools |
| 3 | Disk cache | `~/.peoplelikeus-mcp-session.json` (1h TTL) |
| 4 | Runtime | Call `plu_login` or `plu_set_cookies` tool |

---

## Configuration

### `.mcp.json` (project-level config)

```json
{
  "mcpServers": {
    "peoplelikeus": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/peoplelikeus-mcp/dist/index.js"],
      "env": {
        "PLU_EMAIL": "your@email.com",
        "PLU_PASSWORD": "yourpassword"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PLU_EMAIL` | No* | — | Login email |
| `PLU_PASSWORD` | No* | — | Login password |
| `PLU_COOKIES` | No* | — | Raw cookie string from browser DevTools |
| `PLU_REQUEST_DELAY` | No | `1500` | Delay between requests (ms) |
| `PLU_MAX_RETRIES` | No | `3` | Retries on HTTP 429/503 (0 = fail immediately) |
| `PLU_RETRY_BASE_MS` | No | `2000` | Exponential backoff base (ms) when no `Retry-After` header |

\* At least one auth method required (`PLU_EMAIL` + `PLU_PASSWORD`, `PLU_COOKIES`, or runtime `plu_login`)

---

## Tools (28)

### Auth (3)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `plu_auth_status` | — | Check authentication status |
| `plu_login` | `email`, `password` | Login with credentials |
| `plu_set_cookies` | `cookies` | Inject raw browser cookies |

### Properties (2)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `plu_get_property` | `propertyId` | Property details (public page) |
| `plu_get_my_properties` | — | List your own properties |

### Calendar (6)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `plu_get_availabilities` | `propertyId` | Get availability periods (JSON API) |
| `plu_get_unavailabilities` | `propertyId` | Get unavailability periods (JSON API) |
| `plu_add_availability` | `propertyId`, `startDate`, `endDate`, `sim?`, `non_sim?`, `non_reciprocal?`, `hospitality?` | Add an availability period |
| `plu_delete_availability` | `availabilityId` | Delete an availability period |
| `plu_add_unavailability` | `propertyId`, `startDate`, `endDate` | Add an unavailability period |
| `plu_delete_unavailability` | `unavailabilityId` | Delete an unavailability period |

### Conversations & Messages (5)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `plu_get_conversations` | `filter?`, `page?` | List conversations (filters: `unread`, `exchanges`, `flagged`, `sent`, `received`, `trash`) |
| `plu_get_messages` | `userId`, `propertyId` | Get messages in a conversation thread |
| `plu_send_message` | `toUserId`, `body`, `propertyId`, `chatId?`, `exchangeId?` | Send a message |
| `plu_delete_message` | `messageId` | Delete a message |
| `plu_delete_conversation` | `chatId` | Delete/trash a conversation |

### Exchanges (6)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `plu_get_exchanges` | — | List your exchanges |
| `plu_get_exchange` | `exchangeId` | Exchange details (dates, type, guests) |
| `plu_create_exchange` | `userId`, `propertyId` | Propose a new exchange |
| `plu_update_exchange_dates` | `exchangeId`, `startDate`, `endDate` | Update exchange dates |
| `plu_update_exchange_type` | `exchangeId`, `swapType` | Change type: `simultaneous`, `non_simultaneous`, `non_reciprocal`, `hospitality` |
| `plu_cancel_exchange` | `exchangeId` | Cancel an exchange |

### Search (2)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `plu_search_homes` | `location?`, `country?`, `startDate?`, `endDate?`, `guests?`, `page?` | Search properties |
| `plu_quick_search` | `listingNumber` | Search by listing number |

### Misc (2)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `plu_get_notifications` | — | Get notifications |
| `plu_get_auth_user` | — | Get authenticated user info |

---

## Usage Examples

```
Search for homes in Portugal

Show my conversations

Send a message to user 12345 about property 67890: "Hello, we love your place..."

Add availability for my property 40646 from July 4 to August 29

Show my exchanges

Cancel exchange 22076
```

---

## Architecture

```
src/
├── index.ts    — Entry point, StdioServerTransport
├── server.ts   — 28 MCP tool definitions + request dispatch
├── api.ts      — HTTP client (JSON API + HTML parsing for server-rendered pages)
├── auth.ts     — Laravel session auth (login, CSRF, cookies, disk cache)
└── types.ts    — TypeScript interfaces
```

**Dual API approach:**
- **JSON API**: `/api/availables`, `/api/unavailables`, `/notifications`, `/authuser`
- **HTML parsing**: conversations, exchanges, properties, search results (Laravel Blade templates)

---

## Limitations

- **HTML parsing**: some pages are server-rendered (Blade templates) — data extraction relies on HTML structure which may change
- **No image upload**: multipart upload for property photos not yet implemented
- **No property creation/editing**: only reading is implemented
- **Search**: uses `country_long` parameter; location-based search requires coordinates (Google Places integration not available server-side)
- Rate limiting: default 1500ms between requests (configurable via `PLU_REQUEST_DELAY`); automatic retry with exponential backoff on HTTP 429/503 (respects `Retry-After`)

---

## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

```bash
npm run dev   # Watch mode for development
npm run build # Build for production
```

---

## License

MIT

---
---

<a name="français"></a>

[English](#english) &nbsp;|&nbsp; [Français](#français)

---

# PeopleLikeUs MCP Server

![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.26%2B-purple)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

Un serveur **Model Context Protocol (MCP)** pour interagir avec la plateforme d'échange de maisons [PeopleLikeUs](https://www.peoplelikeus.world) directement depuis votre assistant IA.

Parcourez des propriétés, gérez vos conversations, mettez à jour votre calendrier de disponibilité, suivez vos échanges — le tout en langage naturel.

---

## Fonctionnalités

- **28 outils MCP** couvrant les opérations de lecture et d'écriture
- Recherche de propriétés par pays, localisation, dates
- Messagerie : lire les conversations, envoyer des messages, supprimer des fils
- Gestion du calendrier : ajouter/supprimer des périodes de disponibilité et d'indisponibilité
- Suivi des échanges : créer, modifier dates/type, annuler
- **Connexion automatique** avec email/mot de passe — pas d'extraction manuelle de token
- Cache de session (`~/.peoplelikeus-mcp-session.json`, durée de vie 1h)
- Protection CSRF gérée automatiquement
- Rate limiting avec délai configurable entre les requêtes

---

## Prérequis

- **Node.js** >= 18
- Un compte **PeopleLikeUs** (Premium recommandé)
- Un **client compatible MCP** : tout hôte supportant le Model Context Protocol

---

## Démarrage rapide

```bash
# 1. Cloner et compiler
git clone https://github.com/your-username/peoplelikeus-mcp
cd peoplelikeus-mcp
npm install && npm run build

# 2. Ajouter à la config de votre client MCP (voir Configuration ci-dessous)
```

---

## Authentification

PeopleLikeUs utilise une authentification Laravel par session standard — **pas de CAPTCHA, pas d'Auth0**. La connexion automatique fonctionne directement.

### Option 1 — Connexion automatique (recommandé)

Renseignez `PLU_EMAIL` et `PLU_PASSWORD` dans votre config. Le serveur gère la connexion, les tokens CSRF et la gestion de session automatiquement.

### Option 2 — Cookies navigateur

1. Ouvrez [peoplelikeus.world](https://www.peoplelikeus.world) et connectez-vous
2. Ouvrez les **DevTools** → **Application** → **Cookies**
3. Copiez les valeurs des cookies `laravel_session` et `XSRF-TOKEN`
4. Renseignez dans `PLU_COOKIES` ou appelez `plu_set_cookies` au runtime

> Note : `laravel_session` est httpOnly — il n'est pas visible via `document.cookie`. Vous devez le copier depuis le panneau Cookies des DevTools.

### Option 3 — Connexion runtime

Appelez `plu_login` avec votre email et mot de passe au runtime.

### Priorité d'authentification

| Priorité | Méthode | Description |
|----------|---------|-------------|
| 1 | `PLU_EMAIL` + `PLU_PASSWORD` | Connexion auto (recommandé) |
| 2 | Variable `PLU_COOKIES` | Chaîne de cookies brute depuis DevTools |
| 3 | Cache disque | `~/.peoplelikeus-mcp-session.json` (durée de vie 1h) |
| 4 | Runtime | Appeler l'outil `plu_login` ou `plu_set_cookies` |

---

## Configuration

### `.mcp.json` (config au niveau du projet)

```json
{
  "mcpServers": {
    "peoplelikeus": {
      "type": "stdio",
      "command": "node",
      "args": ["/chemin/absolu/vers/peoplelikeus-mcp/dist/index.js"],
      "env": {
        "PLU_EMAIL": "votre@email.com",
        "PLU_PASSWORD": "votremotdepasse"
      }
    }
  }
}
```

### Variables d'environnement

| Variable | Requis | Défaut | Description |
|----------|--------|--------|-------------|
| `PLU_EMAIL` | Non* | — | Email de connexion |
| `PLU_PASSWORD` | Non* | — | Mot de passe |
| `PLU_COOKIES` | Non* | — | Chaîne de cookies brute depuis DevTools |
| `PLU_REQUEST_DELAY` | Non | `1500` | Délai entre les requêtes (ms) |
| `PLU_MAX_RETRIES` | Non | `3` | Tentatives sur HTTP 429/503 (0 = échec immédiat) |
| `PLU_RETRY_BASE_MS` | Non | `2000` | Base du backoff exponentiel (ms) sans header `Retry-After` |

\* Au moins une méthode d'auth requise (`PLU_EMAIL` + `PLU_PASSWORD`, `PLU_COOKIES`, ou `plu_login` au runtime)

---

## Outils (28)

### Auth (3)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `plu_auth_status` | — | Vérifier le statut d'authentification |
| `plu_login` | `email`, `password` | Se connecter avec ses identifiants |
| `plu_set_cookies` | `cookies` | Injecter des cookies bruts du navigateur |

### Propriétés (2)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `plu_get_property` | `propertyId` | Détails d'une propriété (page publique) |
| `plu_get_my_properties` | — | Lister ses propres propriétés |

### Calendrier (6)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `plu_get_availabilities` | `propertyId` | Périodes de disponibilité (API JSON) |
| `plu_get_unavailabilities` | `propertyId` | Périodes d'indisponibilité (API JSON) |
| `plu_add_availability` | `propertyId`, `startDate`, `endDate`, `sim?`, `non_sim?`, `non_reciprocal?`, `hospitality?` | Ajouter une période de disponibilité |
| `plu_delete_availability` | `availabilityId` | Supprimer une période de disponibilité |
| `plu_add_unavailability` | `propertyId`, `startDate`, `endDate` | Ajouter une période d'indisponibilité |
| `plu_delete_unavailability` | `unavailabilityId` | Supprimer une période d'indisponibilité |

### Conversations et messages (5)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `plu_get_conversations` | `filter?`, `page?` | Liste des conversations (filtres : `unread`, `exchanges`, `flagged`, `sent`, `received`, `trash`) |
| `plu_get_messages` | `userId`, `propertyId` | Messages d'un fil de conversation |
| `plu_send_message` | `toUserId`, `body`, `propertyId`, `chatId?`, `exchangeId?` | Envoyer un message |
| `plu_delete_message` | `messageId` | Supprimer un message |
| `plu_delete_conversation` | `chatId` | Supprimer/mettre à la corbeille une conversation |

### Échanges (6)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `plu_get_exchanges` | — | Lister ses échanges |
| `plu_get_exchange` | `exchangeId` | Détails d'un échange (dates, type, voyageurs) |
| `plu_create_exchange` | `userId`, `propertyId` | Proposer un nouvel échange |
| `plu_update_exchange_dates` | `exchangeId`, `startDate`, `endDate` | Modifier les dates d'un échange |
| `plu_update_exchange_type` | `exchangeId`, `swapType` | Changer le type : `simultaneous`, `non_simultaneous`, `non_reciprocal`, `hospitality` |
| `plu_cancel_exchange` | `exchangeId` | Annuler un échange |

### Recherche (2)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `plu_search_homes` | `location?`, `country?`, `startDate?`, `endDate?`, `guests?`, `page?` | Rechercher des propriétés |
| `plu_quick_search` | `listingNumber` | Recherche par numéro d'annonce |

### Divers (2)

| Outil | Paramètres | Description |
|-------|-----------|-------------|
| `plu_get_notifications` | — | Récupérer les notifications |
| `plu_get_auth_user` | — | Info de l'utilisateur connecté |

---

## Exemples d'utilisation

```
Rechercher des maisons au Portugal

Afficher mes conversations

Envoyer un message à l'utilisateur 12345 à propos de la propriété 67890 : "Bonjour, nous adorons votre logement..."

Ajouter une disponibilité pour ma propriété 40646 du 4 juillet au 29 août

Afficher mes échanges

Annuler l'échange 22076
```

---

## Architecture

```
src/
├── index.ts    — Point d'entrée, StdioServerTransport
├── server.ts   — 28 définitions d'outils MCP + dispatch des requêtes
├── api.ts      — Client HTTP (API JSON + parsing HTML pour pages server-rendered)
├── auth.ts     — Auth session Laravel (login, CSRF, cookies, cache disque)
└── types.ts    — Interfaces TypeScript
```

**Double approche API :**
- **API JSON** : `/api/availables`, `/api/unavailables`, `/notifications`, `/authuser`
- **Parsing HTML** : conversations, échanges, propriétés, résultats de recherche (templates Laravel Blade)

---

## Limitations

- **Parsing HTML** : certaines pages sont rendues côté serveur (templates Blade) — l'extraction des données repose sur la structure HTML qui peut changer
- **Pas d'upload d'images** : l'upload multipart pour les photos n'est pas encore implémenté
- **Pas de création/édition de propriété** : seule la lecture est implémentée
- **Recherche** : utilise le paramètre `country_long` ; la recherche par localisation nécessite des coordonnées (l'intégration Google Places n'est pas disponible côté serveur)
- Rate limiting : 1500ms par défaut entre les requêtes (configurable via `PLU_REQUEST_DELAY`) ; retry automatique avec backoff exponentiel sur HTTP 429/503 (respecte `Retry-After`)

---

## Contribuer

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une issue ou soumettre une pull request.

```bash
npm run dev   # Mode watch pour le développement
npm run build # Compiler pour la production
```

---

## Licence

MIT
