# viewm4d

Standalone PDF viewer app - simpler alternative to web-internal for viewing processed construction plans.

## Commands

```bash
pnpm dev      # Start Vite dev server
pnpm build    # Build for production
```

## Structure

```
src/
├── App.tsx           # Router setup
├── pages/            # Route components
├── components/       # UI components
├── services/         # API calls
├── contexts/         # React context providers
└── types/            # TypeScript interfaces
```

## Stack

- React 19 + Vite + TypeScript
- TailwindCSS 4
- react-router-dom for routing
- react-pdf for PDF rendering

## Purpose

Lightweight viewer for pre-processed plan data. Does not include:
- AI processing (done in web-internal)
- 3D point cloud viewing
- File uploads
- Complex context panels

Intended for customer-facing "view only" access to processed plans.
