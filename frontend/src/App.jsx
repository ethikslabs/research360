import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/shared/Layout.jsx'
import ChatInterface from './components/chat/ChatInterface.jsx'
import LibraryView from './components/library/LibraryView.jsx'
import IngestView from './components/ingest/IngestView.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="chat" element={<ChatInterface />} />
          <Route path="library" element={<LibraryView />} />
          <Route path="ingest" element={<IngestView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
