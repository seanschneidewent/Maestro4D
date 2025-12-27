# context-panel

AI-powered context extraction panel for analyzing construction PDFs and extracting structured "pointers" (annotated regions).

## Key Files

| File | Purpose |
|------|---------|
| `ContextPanel.tsx` | Main panel component (145KB god component) |
| `PagesTab.tsx` | Page-by-page view of extracted contexts |
| `DisciplinesTab.tsx` | Trade/discipline grouped view |
| `GlobalTreeView.tsx` | Hierarchical tree of all contexts |
| `GlobalPreviewView.tsx` | Preview panel for selected pointers |
| `StreamingProcessedView.tsx` | Real-time streaming AI output |

## Hooks (`hooks/`)

| Hook | Purpose |
|------|---------|
| `useAIProcessing.ts` | Streaming AI extraction state |
| `useProcessedBatches.ts` | Batch processing tracking |
| `useProcessingStatus.ts` | Polling for processing state |
| `useProjectContext.ts` | Project data fetching |
| `useRetrieval.ts` | Search result handling |
| `useDisciplineContexts.ts` | Discipline grouping logic |
| `usePageContexts.ts` | Page-level grouping logic |

## Data Flow

1. User selects PDF → triggers `useAIProcessing`
2. Backend streams extraction results → `StreamingProcessedView` displays
3. Results stored as "pointers" with bounding boxes
4. User can view by Pages or Disciplines tabs
5. Clicking pointer → navigates to PDF location with highlight

## Pointer Structure

```typescript
interface Pointer {
  id: string;
  title: string;
  description: string;
  bounding_box: {
    xNorm: number;  // 0-1 normalized
    yNorm: number;
    wNorm: number;
    hNorm: number;
  };
  trade_category: string;
  page_number: number;
  file_id: string;
}
```

## View Modes

- **Pointers**: Raw list of all extracted pointers
- **Pages**: Grouped by PDF page number
- **Disciplines**: Grouped by trade (Electrical, Plumbing, etc.)

## Gotchas

- `ContextPanel.tsx` is 145KB - handles too many concerns, but refactoring risky
- Streaming uses `ReadableStream` API - check browser support
- Processing can timeout on large PDFs - use batch mode
- Tab state resets on component unmount - consider lifting state
