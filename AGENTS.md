# AGENTS.md - Permanent Production Baseline & Development Rules

## Application Identity & Purpose
- **Application Name**: Ink & Witness Narratives
- **Author & Founder**: Jake
- **Description**: Ink & Witness Narratives is a hub of life's contradictions, love essays, erotica stories, intimacy and lust, exploring identity, society, relationships, and the experiences that shape us.

## 1. Permanent Baseline Protection Directive
- **Do NOT Revert**: The current restored version is the primary production baseline. Never revert the website to a default template, blank state, or starter project.
- **Do NOT Overwrite**: Preserve all existing monographs/pieces, author profiles, categories, topics, affiliate networks, payment history, reader licenses, user accounts, and visual design.
- **Incremental Modifications Only**: Every future change must be surgical and strictly modify the specific part requested by the user, leaving the rest of the application fully intact.
- **Data Preservation Priority**: Prioritize persistent data preservation and application stability above all else.

## 2. Persistent Storage & Multi-Tier Architecture
- **Primary Cloud Persistence**: Google Cloud Firestore (`ai-studio-inkwitness-dec98f98-7fd5-48e7-b78f-2afc3b37afef`).
- **Synchronized Fast Cache**: In-memory high-throughput store coupled with atomic persistent disk cache in `./data/`.
- **Automatic Snapshot Backups**: Periodic backups stored in `./data/backups/` to enable safe point-in-time recovery and rollback if needed.
- **Assets Persistence**: Uploaded author covers and branding photos are stored permanently with Firestore replication so they survive deployments and container restarts.

## 3. Strong Security & Access Control Standards
- **Server-Side Authorization**: Paid piece content is masked and protected on the backend. Only authenticated readers with verified reader licenses or administrators receive full monograph text.
- **Password Security**: Argon2id password hashing with secure salt and complexity validation for users, admin, and affiliate partners.
- **Payment & Secret Protection**: All M-Pesa Consumer Keys, Consumer Secrets, Passkeys, Till Numbers, and Gemini API keys remain strictly server-side.
- **Strict Rate Limiting**: Dedicated rate limiters configured for authentication, registration, M-Pesa STK push, access verification, and status polling.
- **Security Headers**: Helmet CSP, Frame protection, strict CORS, and HttpOnly Secure cookies.

## 4. Operational Guidelines
- Before modifying database schemas or critical endpoints, always ensure data validation and backward compatibility.
- Never run truncation or reset commands on production collections.
