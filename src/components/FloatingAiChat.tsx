// src/components/FloatingAiChat.tsx
import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { HarFile } from '../types/har';
import './FloatingAiChat.css';
import { ConsoleLogFile } from '../types/consolelog';

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

const FloatingAiChat: React.FC<FloatingAiChatProps> = ({ harData, logData }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [ocaConnected, setOcaConnected] = useState<boolean>(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // ---- Context helpers ----
  const getHarContext = () => {
    if (!harData) return '';
    const entries = harData.log.entries;

    // Aggregate summary
    const totalSize = entries.reduce(
      (sum, e) => sum + (e.response.bodySize > 0 ? e.response.bodySize : 0),
      0
    );
    const totalTime = entries.reduce((sum, e) => sum + e.time, 0);
    const domains = [
      ...new Set(
        entries.map((e) => {
          try {
            return new URL(e.request.url).hostname;
          } catch {
            return 'unknown';
          }
        })
      ),
    ];
    const errorCount = entries.filter(e => e.response.status >= 400).length;

    const summary = `HAR File Summary:
- Total Requests: ${entries.length}
- Total Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB
- Total Time: ${(totalTime / 1000).toFixed(2)}s
- Unique Domains: ${domains.join(', ')}
- Failed Requests: ${errorCount}`;

    // Top 30 requests sorted by time descending
    const topRequests = [...entries]
      .sort((a, b) => b.time - a.time)
      .slice(0, 30)
      .map((e, i) => {
        let domain = 'unknown';
        try {
          domain = new URL(e.request.url).hostname;
        } catch {
          // Keep unknown domain
        }

        const sizeKb = e.response.bodySize > 0 ? e.response.bodySize / 1024 : 0;
        return `#${i + 1} [${e.request.method}] ${e.request.url}
  Status: ${e.response.status} | Time: ${e.time.toFixed(0)}ms | Size: ${sizeKb.toFixed(1)}KB
  DNS: ${((e.timings?.dns as number) || 0).toFixed(0)}ms | Connect: ${((e.timings?.connect as number) || 0).toFixed(0)}ms | SSL: ${((e.timings?.ssl as number) || 0).toFixed(0)}ms | Wait: ${((e.timings?.wait as number) || 0).toFixed(0)}ms | Receive: ${((e.timings?.receive as number) || 0).toFixed(0)}ms`;
      })
      .join('\n\n');

    // All failed requests
    const failedRequests = entries
      .filter((e) => e.response.status >= 400)
      .map(
        (e) =>
          `[${e.request.method}] ${e.request.url} -> ${e.response.status} ${e.response.statusText}`
      )
      .join('\n');

    return `${summary}

Top 30 Requests by Duration:
${topRequests}

${errorCount > 0 ? `Failed Requests:\n${failedRequests}` : ''}`;
  };

  const getLogSummary = () => {
    if (!logData) return '';
    const entries = logData.entries;
    const sources = [...new Set(entries.map(e => e.source).filter(Boolean))];
    return `Console Log Context:
- Total Entries: ${entries.length}
- Errors: ${entries.filter(e => e.level === 'error').length}
- Warnings: ${entries.filter(e => e.level === 'warn').length}
- Info Messages: ${entries.filter(e => e.level === 'info').length}
- Unique Sources: ${sources.length}`;
  };

  // Calls backend proxy and parses OpenAI SSE format.
  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const contextSummary = isConsoleMode ? getLogSummary() : getHarContext();

      const systemPrompt = isConsoleMode
        ? `You are an expert console log analyst. You have been given detailed console log context below. Answer questions directly using the data - never say you lack information if it is present in the context. Format responses with strict GitHub markdown. Rules: use '-' bullet lists (NO blank lines between items); indent sub-details with '   - ' (3 spaces + dash); use backtick \`code\` for values; use **bold** for key metrics. Never use unicode bullets.

${contextSummary}`
        : `You are an expert HAR file network analyst. You have been given detailed per-request data below. Answer questions directly using the data - never say you lack information if it is present in the context. Format responses with strict GitHub markdown. Rules: use '1.' numbered lists for request entries (NO blank lines between items); indent sub-details with '   - ' (3 spaces + dash); use backtick \`code\` for URLs and values; use **bold** for key timings. Never use unicode bullets or #N- prefixes.

${contextSummary}`;

      // OpenAI chat/completions format.
      const response = await fetch(`${BACKEND_AI_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt,
          messages: [{ role: 'user', content: input }],
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

  // ---- Everything below: COMPLETELY UNCHANGED ----
  const quickQuestions = isConsoleMode
    ? ['Show me all errors', 'What are the most common warnings?', 'Identify any patterns']
    : ['Show slowest requests', 'Any errors?', 'Performance issues?'];

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
