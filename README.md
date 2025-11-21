# Maestro 4D Monorepo

Construction project management platform with React web app, FastAPI backend, and native iPad app.

## Structure

- `apps/web-internal/` - React/Vite internal dashboard (Maestro 4D)
- `apps/ios-customer/` - SwiftUI iPad app for customers
- `packages/api/` - FastAPI backend
- `packages/shared-types/` - Shared TypeScript types

## Getting Started

### Install Dependencies
\`\`\`bash
pnpm install
cd packages/api && pip install -r requirements.txt
\`\`\`

### Run Development
\`\`\`bash
# Terminal 1: React app
pnpm dev:web

# Terminal 2: API
pnpm dev:api

# Terminal 3: iOS app
open apps/ios-customer/MaestroCustomer.xcodeproj
# Press ▶️ in Xcode
\`\`\`