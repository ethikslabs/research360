# Research360 — Frontend Brief (Claude Code)

## Your Job

Build the Research360 frontend. This is a knowledge chat interface — part research tool, part demonstrable platform product. Read `architecture.md` fully before writing any code.

The API is already built. Your job is to build a clean, credible interface that consumes it.

---

## What You Are Building

A single-page React application with three views:

1. **Chat** — main interface, query Research360, see answers with sources
2. **Library** — manage ingested documents
3. **Ingest** — upload files or submit URLs

The interface must feel like a product, not a prototype. It will be demonstrated to vendor partners.

---

## Stack

- **Framework**: React (Vite)
- **Styling**: Tailwind CSS
- **HTTP**: fetch (no axios)
- **State**: React useState / useReducer (no Redux)
- **Routing**: React Router v6
- **Deployment**: Docker + Nginx

---

## Directory Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── chat/
│   │   │   ├── ChatInterface.jsx       ← main chat view
│   │   │   ├── MessageBubble.jsx       ← single message
│   │   │   ├── SourceCard.jsx          ← source citation card
│   │   │   ├── SuggestionChips.jsx     ← suggested next questions
│   │   │   ├── PersonaSelector.jsx     ← strategist / analyst toggle
│   │   │   ├── ComplexitySelector.jsx  ← simple / detailed / deep
│   │   │   └── ChatInput.jsx           ← query input
│   │   ├── library/
│   │   │   ├── LibraryView.jsx         ← document list
│   │   │   └── DocumentRow.jsx         ← single document row
│   │   ├── ingest/
│   │   │   ├── IngestView.jsx          ← upload + URL form
│   │   │   ├── FileUpload.jsx          ← drag and drop file upload
│   │   │   └── UrlIngest.jsx           ← URL/YouTube input
│   │   └── shared/
│   │       ├── Layout.jsx              ← sidebar + main area
│   │       ├── Sidebar.jsx             ← navigation
│   │       ├── StatusBadge.jsx         ← PENDING / INDEXED / FAILED
│   │       └── LoadingDots.jsx         ← streaming loading indicator
│   ├── hooks/
│   │   ├── useChat.js                  ← chat state and API calls
│   │   └── useDocuments.js             ← document library state
│   ├── api/
│   │   └── research360.js             ← all API calls
│   ├── config/
│   │   └── index.js                    ← API base URL, defaults
│   ├── App.jsx
│   └── main.jsx
├── Dockerfile
├── nginx.conf
├── package.json
└── vite.config.js
```

---

## Layout

Three-column structure:

```
┌─────────────┬──────────────────────────────┬──────────────┐
│   Sidebar   │        Main Content          │  (reserved)  │
│  120px      │        flex-1                │              │
│             │                              │              │
│  Logo       │  Chat / Library / Ingest     │              │
│  Nav        │                              │              │
│             │                              │              │
└─────────────┴──────────────────────────────┴──────────────┘
```

Sidebar is always visible. Main content area switches based on route.

---

## Visual Design

**Palette**:
- Background: `#0f0f0f` (near black)
- Surface: `#1a1a1a`
- Surface elevated: `#242424`
- Border: `#2e2e2e`
- Text primary: `#f0f0f0`
- Text secondary: `#8a8a8a`
- Accent: `#6366f1` (indigo — use sparingly)
- Success: `#22c55e`
- Warning: `#f59e0b`
- Danger: `#ef4444`

**Typography**:
- Font: Inter (Google Fonts)
- Body: 14px / 400
- Labels: 12px / 500
- Headings: 16–20px / 600

**Feel**: Dark, dense, professional. Similar to a research terminal. Not consumer-app bright. Every element earns its place.

**Spacing**: 8px base unit. Generous padding inside cards (16px+). Tight between list items (4–8px).

---

## Sidebar

```
┌─────────────┐
│  R360       │  ← logo/wordmark, 16px bold
│             │
│  ○ Chat     │  ← nav item, active = indigo left border
│  ○ Library  │
│  ○ Ingest   │
│             │
│             │
│  ethikslabs │  ← bottom, 11px secondary
└─────────────┘
```

Active nav item has `border-l-2 border-indigo-500 bg-white/5` treatment.

---

## Chat Interface

This is the primary view. Most important component to get right.

### Layout

```
┌──────────────────────────────────────────────┐
│  Persona: [Strategist] [Analyst]             │
│  Depth:   [Simple] [Detailed] [Deep]         │
├──────────────────────────────────────────────┤
│                                              │
│  [messages scroll area]                      │
│                                              │
│                                              │
├──────────────────────────────────────────────┤
│  [suggestion chips if present]               │
├──────────────────────────────────────────────┤
│  [input area]                                │
└──────────────────────────────────────────────┘
```

### PersonaSelector

Two toggle buttons at the top. Selected = filled indigo. Unselected = ghost.

```jsx
<PersonaSelector 
  value={persona}           // 'strategist' | 'analyst'
  onChange={setPersona} 
/>
```

Labels: "Strategist" / "Analyst". No icons needed.

### ComplexitySelector

Three-way toggle. Same pattern.

```jsx
<ComplexitySelector 
  value={complexity}        // 'simple' | 'detailed' | 'deep'
  onChange={setComplexity} 
/>
```

Labels: "Simple" / "Detailed" / "Deep"

### Message Thread

Each message is a `MessageBubble`. Two variants:

**User bubble**:
- Right-aligned
- `bg-indigo-600` background
- `text-white`
- Rounded: `rounded-2xl rounded-tr-sm`
- Max width 70%

**Assistant bubble**:
- Left-aligned
- `bg-[#242424]` background
- Full width
- Contains: answer text + persona badge + sources accordion + suggestions

### Assistant Message Structure

```
┌──────────────────────────────────────┐
│ [Strategist] badge                   │
│                                      │
│ Answer text renders here.            │
│ Markdown supported.                  │
│                                      │
│ ▼ Sources (3)                        │  ← collapsible, open by default
│   ┌────────────────────────────┐     │
│   │ 📄 AI Infrastructure Pod...│     │
│   │ YouTube · chunk 4 · 0.91  │     │
│   │ "...the key insight was..."│     │
│   └────────────────────────────┘     │
│   ┌────────────────────────────┐     │
│   │ 📄 Investor Memo Q1 2025  │     │
│   │ Document · chunk 12 · 0.87│     │
│   │ "...strategic context..."  │     │
│   └────────────────────────────┘     │
└──────────────────────────────────────┘
```

### SourceCard

Each source is a card inside the sources accordion:

```
┌──────────────────────────────────────┐
│ [icon] Document Title                │  ← truncate if long
│ source_type · chunk N · score        │  ← 12px secondary
│                                      │
│ "chunk_text excerpt..."              │  ← first 200 chars, italic, secondary
└──────────────────────────────────────┘
```

Source type icons (text-based, not emoji):
- `document` → 📄 or a simple doc SVG
- `url` → 🔗
- `youtube` → ▶

Relevance score: show as percentage rounded to whole number (0.91 → 91%).

Sources accordion is open by default. User can collapse it.

### SuggestionChips

Rendered below the last assistant message only (not historical messages).

Horizontal row of pill buttons:

```jsx
<SuggestionChips 
  suggestions={['What are the key risks?', 'Compare to previous research', '...']}
  onSelect={(text) => submitQuery(text)}
/>
```

Clicking a chip submits it as the next query. Pills: `border border-white/20 rounded-full px-3 py-1 text-xs hover:border-indigo-500 cursor-pointer`.

Chips disappear once any new message is sent.

### ChatInput

Bottom of chat. Pinned.

```
┌──────────────────────────────────────┐
│  Ask Research360...          [Send]  │
└──────────────────────────────────────┘
```

- Textarea that auto-grows (max 4 lines)
- Submit on Enter (Shift+Enter for newline)
- Disabled while awaiting response
- Shows `LoadingDots` in thread while waiting — not in the input

### LoadingDots

Three dots pulsing. Shown as a fake assistant bubble while waiting for response.

```jsx
// simple CSS animation, three dots, secondary colour
```

### Empty State

When no messages exist:

```
┌──────────────────────────────────────┐
│                                      │
│         Research360                  │
│                                      │
│   Ask anything across your          │
│   ingested knowledge base.           │
│                                      │
│   ┌─────────────────────────────┐   │
│   │ What were the key insights  │   │  ← suggestion chip
│   │ from my last upload?        │   │
│   └─────────────────────────────┘   │
│   ┌─────────────────────────────┐   │
│   │ Summarise my research on    │   │
│   │ cloud architecture          │   │
│   └─────────────────────────────┘   │
│                                      │
└──────────────────────────────────────┘
```

Static suggestions. Clicking submits the query.

---

## Library View

Document list with status indicators.

```
┌─────────────────────────────────────────────┐
│ Library                          [+ Ingest] │
├─────────────────────────────────────────────┤
│ Filter: [All] [Documents] [URLs] [YouTube]  │
├─────────────────────────────────────────────┤
│ 📄 AI Infrastructure Research               │
│    PDF · 34 chunks · INDEXED · 2 days ago   │
├─────────────────────────────────────────────┤
│ ▶  How to Build a RAG System               │
│    YouTube · 67 chunks · INDEXED · 5d ago  │
├─────────────────────────────────────────────┤
│ 🔗 Anthropic Research Blog                  │
│    URL · 12 chunks · INDEXED · 1 week ago  │
├─────────────────────────────────────────────┤
│ 📄 Quarterly Strategy Deck                  │
│    PPTX · — · PROCESSING · just now        │
└─────────────────────────────────────────────┘
```

- Poll `GET /research360/documents` every 5 seconds to update processing status
- `PENDING` / `PROCESSING` rows show a subtle animated left border (indigo pulse)
- `INDEXED` rows show green dot
- `FAILED` rows show red dot with error tooltip
- Clicking a row opens a detail panel (slide in from right) showing metadata and chunk count
- Delete button on hover (right side of row) — confirm before deleting

### StatusBadge

```jsx
<StatusBadge status="INDEXED" />
// renders: green dot + "Indexed"

<StatusBadge status="PENDING" />
// renders: amber dot + "Processing" (animated)

<StatusBadge status="FAILED" />
// renders: red dot + "Failed"
```

---

## Ingest View

Two tabs: File Upload and URL.

### File Upload Tab

Drag and drop zone:

```
┌─────────────────────────────────────────┐
│                                         │
│   Drag files here, or click to browse   │
│                                         │
│   PDF · DOCX · PPTX                     │
│                                         │
└─────────────────────────────────────────┘
```

- Accepts: `.pdf`, `.docx`, `.pptx`
- Multiple files supported — queue them
- On drop/select: show file list with name and size
- Optional title field per file
- Upload button submits all queued files
- Progress shown per file during upload
- On success: redirect to Library view

### URL Tab

```
┌─────────────────────────────────────────┐
│ URL or YouTube link                     │
│ ┌───────────────────────────────────┐  │
│ │ https://...                       │  │
│ └───────────────────────────────────┘  │
│                                         │
│ Title (optional)                        │
│ ┌───────────────────────────────────┐  │
│ │                                   │  │
│ └───────────────────────────────────┘  │
│                                         │
│                        [Add to Queue]  │
│                                         │
│ Queue                                   │
│ ┌───────────────────────────────────┐  │
│ │ ▶ youtube.com/watch?v=...         │  │
│ │ 🔗 anthropic.com/research/...     │  │
│ └───────────────────────────────────┘  │
│                                         │
│                       [Ingest All →]   │
└─────────────────────────────────────────┘
```

- Detect YouTube URLs and show `▶` icon automatically
- Queue multiple URLs before submitting
- On submit: POST each URL, redirect to Library

---

## API Module

`src/api/research360.js` — all API calls in one file:

```javascript
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export async function ingestFile(file, title) { ... }
export async function ingestUrl(url, title) { ... }
export async function listDocuments(filters) { ... }
export async function getDocument(id) { ... }
export async function deleteDocument(id) { ... }
export async function query({ query, persona, complexity, sessionId, filters }) { ... }
export async function getSession(sessionId) { ... }
```

Handle errors consistently — throw with `{ message, status }` shape.

---

## useChat Hook

```javascript
function useChat() {
  const [messages, setMessages] = useState([])
  const [persona, setPersona] = useState('strategist')
  const [complexity, setComplexity] = useState('detailed')
  const [sessionId, setSessionId] = useState(null)
  const [loading, setLoading] = useState(false)

  async function submit(queryText) {
    // add user message immediately
    // set loading true
    // call query API
    // add assistant message with answer + sources + suggestions
    // set loading false
  }

  return { messages, persona, setPersona, complexity, setComplexity, loading, submit }
}
```

---

## Environment Variables

```
VITE_API_URL=http://localhost:3000
```

---

## Dockerfile

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

```nginx
# nginx.conf
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;
  location / { try_files $uri $uri/ /index.html; }
  location /research360 { proxy_pass http://api:3000; }
}
```

---

## Build Order

1. `Layout.jsx` + `Sidebar.jsx` + routing — shell works, nav switches views
2. `IngestView.jsx` — file upload and URL ingest working end-to-end
3. `LibraryView.jsx` — document list with polling
4. `ChatInterface.jsx` + `ChatInput.jsx` — basic send/receive working
5. `MessageBubble.jsx` — user and assistant variants
6. `SourceCard.jsx` + sources accordion in assistant bubble
7. `SuggestionChips.jsx` — chips appear, clicking submits
8. `PersonaSelector.jsx` + `ComplexitySelector.jsx`
9. `LoadingDots.jsx` + empty state
10. Polish: animations, error states, responsive tweaks
11. Dockerfile

Test at each step. Do not move to polish until core flows work.

---

## Definition of Done

- Can upload a PDF from the Ingest view and see it appear in Library as INDEXED
- Can submit a YouTube URL and see it move through PENDING → INDEXED
- Can type a query in Chat and receive an answer
- Answer shows persona badge
- Sources section shows document title, type, chunk excerpt, relevance score
- Sources section is collapsible
- Suggestion chips appear after each assistant response
- Clicking a chip submits it as the next query
- Persona toggle changes the badge on responses
- Complexity toggle works (visible in response depth)
- Library filters work (All / Documents / URLs / YouTube)
- Processing documents show animated status
- Delete works with confirmation
- Docker container builds and serves correctly