// src/components/FloatingAiChat.tsx
import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { HarFile } from '../types/har';
import './FloatingAiChat.css';
import { ConsoleLogFile } from '../types/consolelog';
import { buildHarContext } from '../hooks/useInsights';
import { buildConsoleLogContext } from '../hooks/useConsoleLogInsights';

const BACKEND_BASE_URL =
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.VITE_API_URL ||
  'http://localhost:4000';
const BACKEND_AI_URL = `${BACKEND_BASE_URL}/api/ai`;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface FloatingAiChatProps {
  harData?: HarFile;
  logData?: ConsoleLogFile;
}

// ── Module-level persistence ────────────────────────────────────────────────
// React state is destroyed whenever the component unmounts (e.g. the user
// switches tool tabs and comes back). These Maps live for the lifetime of the
// browser session and restore the chat exactly as the user left it.
interface ChatSnapshot {
  messages: Message[];
  isOpen: boolean;
  isMinimized: boolean;
}
const chatSnapshotCache = new Map<string, ChatSnapshot>();

/** Derive a stable key that uniquely identifies the currently-loaded file. */
function buildCacheKey(harData?: HarFile, logData?: ConsoleLogFile): string {
  if (harData) {
    const count = harData.log.entries.length;
    const first = harData.log.entries[0]?.startedDateTime ?? '';
    return `har:${count}:${first}`;
  }
  if (logData) {
    const count = logData.entries.length;
    const name  = logData.metadata?.fileName ?? '';
    return `log:${count}:${name}`;
  }
  return 'empty';
}

const FloatingAiChat: React.FC<FloatingAiChatProps> = ({ harData, logData }) => {
  const cacheKey = buildCacheKey(harData, logData);
  const snapshot = chatSnapshotCache.get(cacheKey);

  const [isOpen, setIsOpen]           = useState<boolean>(snapshot?.isOpen       ?? false);
  const [isMinimized, setIsMinimized] = useState<boolean>(snapshot?.isMinimized  ?? false);
  const [messages, setMessages]       = useState<Message[]>(snapshot?.messages   ?? []);
  const [input, setInput]             = useState('');
  const [isLoading, setIsLoading]     = useState(false);
  const [ocaConnected, setOcaConnected] = useState<boolean>(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);

  // Persist state to the module-level cache so it survives tab switches.
  // We write on every change so the snapshot is always up-to-date.
  useEffect(() => {
    chatSnapshotCache.set(cacheKey, { messages, isOpen, isMinimized });
  }, [cacheKey, messages, isOpen, isMinimized]);

  const isConsoleMode = !!logData;

  const normalizeAssistantMarkdown = (text: string) => {
    if (!text) return '';

    let normalized = text.replace(/\r\n/g, '\n');

    // Convert "#N -" style markers into proper numbered markdown items.
    normalized = normalized.replace(
      /^[ \t]*(?:[\u2022\u25CF\u25AA\u25B8\u25B9]\s*)?#(\d+)\s*[\u2014\u2013\u2012\u2015\-]\s+/gm,
      '$1. '
    );

    // Normalize remaining unicode bullets to markdown bullets.
    normalized = normalized.replace(/^[ \t]*[\u2022\u25CF\u25AA\u25B8\u25B9]\s+/gm, '- ');
    normalized = normalized.replace(/^[ \t]*[\u25E6\u25AB\u2023]\s+/gm, '  - ');

    // Trim trailing spaces and excessive blank lines
    normalized = normalized.replace(/[ \t]+\n/g, '\n');
    normalized = normalized.replace(/\n{3,}/g, '\n\n');

    // Collapse single blank lines between consecutive list-item lines (prevents loose lists)
    let prev: string;
    do {
      prev = normalized;
      normalized = normalized.replace(
        /(\n[ \t]*(?:\d+\.|-|\*|\+|[\u2022\u25CF\u25AA\u25B8\u25B9\u25E6\u25AB\u2023])\s.+)\n\n([ \t]*(?:\d+\.|-|\*|\+|[\u2022\u25CF\u25AA\u25B8\u25B9\u25E6\u25AB\u2023])\s)/g,
        '$1\n$2'
      );
    } while (normalized !== prev);

    return normalized.trim();
  };

  useEffect(() => {
    if (isOpen) checkOca();
  }, [isOpen]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Use backend status endpoint for connectivity checks.
  const checkOca = async () => {
    try {
      const res = await fetch(`${BACKEND_AI_URL}/status`);
      if (!res.ok) {
        setOcaConnected(false);
        return;
      }

      const data = (await res.json()) as { connected?: boolean };
      setOcaConnected(Boolean(data.connected));
    } catch {
      setOcaConnected(false);
    }
  };

  // ---- Context helpers (reuse the same rich builders as the Insights panel) ----
  // This ensures the chat sees exactly the same 5xx→4xx→3xx→2xx prioritised context
  // as the structured insights endpoint, plus Oracle product detection on the backend.
  const getHarContext = () => (harData ? buildHarContext(harData) : '');
  const getLogContext  = () => (logData ? buildConsoleLogContext(logData) : '');

  // Calls backend proxy and parses OpenAI SSE format.
  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    // Capture current messages BEFORE the state update so we can build the history array.
    const historySnapshot = messages;

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const fileContext = isConsoleMode ? getLogContext() : getHarContext();

      // System prompt: Oracle-aware analyst persona + 5xx→4xx priority rule + file context.
      // The backend will additionally inject Oracle product KB detected from the context.
      const systemPrompt = isConsoleMode
        ? `You are an Oracle Support Analyst specialising in console log triage for Oracle products.
Analyse issues in strict priority order: HTTP 5xx server errors first, then 4xx client/auth errors, then application errors, then warnings.
For 5xx entries: name the Oracle product/component, the server-side root cause, and the exact config fix.
For 4xx entries: identify IDCS/OAM token failures, missing Oracle module registrations, or rate limits.
Answer questions directly using the data — never claim information is absent if it appears in the context.
Format responses with strict GitHub markdown: use '-' bullet lists (no blank lines between items); indent sub-details with '   - '; use \`backtick\` for values; **bold** critical findings. Never use unicode bullets.

${fileContext}`
        : `You are an Oracle Support Analyst specialising in HAR trace triage for Oracle products.
Analyse issues in strict priority order: 5xx server errors first → 4xx client/auth errors → 3xx redirect issues → 2xx performance.
For every distinct 5xx endpoint: identify the Oracle product/component, the server-side cause, and the exact config fix.
For 4xx: check auth flows (IDCS/OAM), missing Oracle module registrations (ORDS/ADF/VB), rate limiting (429).
Context field guide: wait= is server processing time (TTFB); [NEW-CONN] means fresh TCP (dns+connect are real costs); wait_ratio >80% means server bottleneck; ENDS_ON_ERROR_PAGE is critical even when HTTP codes are 2xx/3xx; ERROR CLUSTERS shows the same endpoint failing repeatedly.
Answer questions directly using the data — never claim information is absent if it appears in the context.
Format responses with strict GitHub markdown: use numbered lists for request entries; indent sub-details with '   - '; \`backtick\` for URLs/values; **bold** critical timings. Never use unicode bullets.

${fileContext}`;

      // Pass the full conversation history so the model maintains context across turns.
      const conversationMessages = [
        ...historySnapshot.map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: input },
      ];

      // OpenAI chat/completions format.
      const response = await fetch(`${BACKEND_AI_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt,
          messages: conversationMessages,
        }),
      });

      if (!response.ok) {
        throw new Error(`Chat request failed (${response.status})`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      let assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

          for (const line of lines) {
            const data = line.slice(6).trim(); // strip "data: "
            if (data === '[DONE]') break;
            try {
              const json = JSON.parse(data);
              // OpenAI SSE format, not Ollama's json.response format.
              const content = json.choices?.[0]?.delta?.content;
              if (content) {
                assistantMessage.content += content;
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...assistantMessage };
                  return updated;
                });
              }
            } catch { /* skip malformed lines */ }
          }
        }
      }
    } catch {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Failed to get response. Make sure the backend is running and the OCA token is valid.',
        timestamp: new Date(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ---- Quick questions: Oracle-aware, error-tier-first ----
  const quickQuestions = isConsoleMode
    ? [
        'Show all HTTP 5xx server errors in the logs',
        'What are the most critical errors and their root cause?',
        'Are there any repeated error patterns or cascades?',
        'Which Oracle product or module is generating the most errors?',
      ]
    : [
        'Are there any 5xx server errors? What is the root cause?',
        'Show all 4xx errors — any auth or missing-resource issues?',
        'Which Oracle products are involved and are there known issues?',
        'What is the slowest part of the session and why?',
      ];

  const dataCount = isConsoleMode
    ? logData?.entries.length || 0
    : harData?.log.entries.length || 0;

  if (!isOpen) {
    return (
      <button className="ai-chat-floating-button" onClick={() => setIsOpen(true)}>
        <svg className="ai-chat-icon-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12C2 13.54 2.38 14.99 3.06 16.26L2 22L7.74 20.94C9.01 21.62 10.46 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2Z" fill="currentColor" />
          <circle cx="8" cy="12" r="1.5" fill="white" />
          <circle cx="12" cy="12" r="1.5" fill="white" />
          <circle cx="16" cy="12" r="1.5" fill="white" />
        </svg>
        <span className="ai-chat-label">AI Assistant</span>
      </button>
    );
  }

  return (
    <div className={`ai-chat-widget ${isMinimized ? 'minimized' : ''}`}>
      <div className="ai-chat-header">
        <div className="ai-chat-title">
          <div className="ai-chat-avatar">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" opacity="0.3" />
              <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h3>AI Assistant</h3>
            {ocaConnected ? (
              <span className="ai-chat-status">
                <span className="ai-chat-status-indicator"></span>
                Online - OCA gpt-5.4
              </span>
            ) : (
              <span className="ai-chat-status ai-chat-status-offline">
                <span className="ai-chat-status-indicator offline"></span>
                Connectivity check failed
              </span>
            )}
          </div>
        </div>
        <div className="ai-chat-actions">
          <button className="ai-chat-action-btn" onClick={() => setIsMinimized(!isMinimized)} title={isMinimized ? 'Expand' : 'Minimize'}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              {isMinimized ? (
                <rect x="3" y="3" width="10" height="10" stroke="currentColor" strokeWidth="2" />
              ) : (
                <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="2" />
              )}
            </svg>
          </button>
          <button className="ai-chat-action-btn" onClick={() => setIsOpen(false)} title="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {!ocaConnected && (
            <div className="ai-chat-connection-warning">
              <span>AI connectivity check failed. You can still send a message.</span>
              <button className="ai-chat-retry-btn" onClick={checkOca}>
                Retry
              </button>
            </div>
          )}
          <div className="ai-chat-messages">
            {messages.length === 0 && (
              <div className="ai-chat-welcome">
                <div className="ai-chat-welcome-icon">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" opacity="0.2" />
                    <path d="M2 17L12 22L22 17M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </div>
                <h3>Welcome!</h3>
                <p>I'm analyzing your {isConsoleMode ? 'console logs' : 'HAR file'} with {dataCount} {isConsoleMode ? 'entries' : 'requests'}.</p>
                <p>Ask me about {isConsoleMode ? 'errors, warnings, or patterns' : 'performance, errors, or any specific requests'}.</p>
                <div className="ai-chat-quick-questions">
                  {quickQuestions.map((q, i) => (
                    <button key={i} className="ai-chat-quick-question-btn" onClick={() => { setInput(q); textareaRef.current?.focus(); }}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M8 3V13M13 8H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => (
              <div key={message.id} className={`ai-chat-message ai-chat-message-${message.role}`}>
                <div className="ai-chat-message-avatar">
                  {message.role === 'user' ? (
                    <svg viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="8" r="4" fill="currentColor" />
                      <path d="M6 21C6 17.6863 8.68629 15 12 15C15.3137 15 18 17.6863 18 21" stroke="currentColor" strokeWidth="2" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none">
                      <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" opacity="0.3" />
                      <path d="M2 17L12 22L22 17M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" />
                    </svg>
                  )}
                </div>
                <div className="ai-chat-message-bubble">
                  {message.role === 'assistant' ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {normalizeAssistantMarkdown(message.content)}
                    </ReactMarkdown>
                  ) : (
                    message.content
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="ai-chat-message ai-chat-message-assistant">
                <div className="ai-chat-message-avatar">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" opacity="0.3" />
                    <path d="M2 17L12 22L22 17M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </div>
                <div className="ai-chat-message-bubble">
                  <div className="ai-chat-typing"><span></span><span></span><span></span></div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="ai-chat-input">
            <textarea
              ref={textareaRef}
              className="ai-chat-textarea"
              placeholder={`Ask about ${isConsoleMode ? 'these logs' : 'this HAR file'}...`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              rows={1}
              disabled={isLoading}
            />
            <button className="ai-chat-send" onClick={sendMessage} disabled={isLoading || !input.trim()}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default FloatingAiChat;
