import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  MessageCircle,
  X,
  Minus,
  Send,
  RefreshCw,
  WifiOff,
  Bot,
  User,
  Sparkles,
  Zap,
} from 'lucide-react';
import { wsClient } from '../services/websocketClient';
import './FloatingAiChat.css';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface FloatingAiChatProps {
  fileId: string;
  fileType: 'har' | 'console';
}

const FloatingAiChat: React.FC<FloatingAiChatProps> = ({ fileId, fileType }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [dataCount, setDataCount] = useState<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isConsoleMode = fileType === 'console';

  const quickQuestions = isConsoleMode
    ? ['Show all errors', 'Most common warnings?', 'Identify patterns']
    : ['What are the slowest requests?', 'Show failed requests', 'Any performance issues?'];

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 80)}px`;
    }
  }, [input]);

  // Check connection + fetch data count when opened
  useEffect(() => {
    if (isOpen) {
      setIsConnected(wsClient.isConnected());
      fetchDataCount();
    }
  }, [isOpen, fileId]);

  const fetchDataCount = async () => {
    try {
      const endpoint = isConsoleMode
        ? `http://localhost:4000/api/console-log/${fileId}/entries?page=1&limit=1`
        : `http://localhost:4000/api/har/${fileId}/entries?page=1&limit=1`;
      const response = await fetch(endpoint);
      if (!response.ok) return;
      const data = await response.json();
      setDataCount(data.pagination?.totalEntries || data.totalCount || data.total || 0);
    } catch {
      setDataCount(0);
    }
  };

  // WebSocket event listeners
  useEffect(() => {
    const handleAiStream = (data: any) => {
      if (data.fileId !== fileId) return;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.isStreaming) {
          return [...prev.slice(0, -1), { ...last, content: last.content + data.chunk }];
        }
        return [...prev, {
          id: data.messageId || Date.now().toString(),
          role: 'assistant',
          content: data.chunk,
          timestamp: new Date(),
          isStreaming: true,
        }];
      });
    };

    const handleAiComplete = (data: any) => {
      if (data.fileId !== fileId) return;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.isStreaming) return [...prev.slice(0, -1), { ...last, isStreaming: false }];
        return prev;
      });
      setIsLoading(false);
    };

    const handleAiError = (data: any) => {
      if (data.fileId !== fileId) return;
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Error: ${data.error || 'Failed to get a response. Is Ollama running with llama3.2?'}`,
        timestamp: new Date(),
        isStreaming: false,
      }]);
      setIsLoading(false);
    };

    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => setIsConnected(false);

    wsClient.on('ai:stream', handleAiStream);
    wsClient.on('ai:complete', handleAiComplete);
    wsClient.on('ai:error', handleAiError);
    wsClient.on('connect', handleConnect);
    wsClient.on('disconnect', handleDisconnect);

    return () => {
      wsClient.off('ai:stream', handleAiStream);
      wsClient.off('ai:complete', handleAiComplete);
      wsClient.off('ai:error', handleAiError);
      wsClient.off('connect', handleConnect);
      wsClient.off('disconnect', handleDisconnect);
    };
  }, [fileId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    if (!isConnected) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: 'Not connected to the backend. Please ensure the backend is running on port 4000.',
        timestamp: new Date(),
      }]);
      return;
    }

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
      wsClient.sendAiQuery(fileId, input);
    } catch {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Failed to send message. Please check your connection.',
        timestamp: new Date(),
      }]);
      setIsLoading(false);
    }
  }, [input, isLoading, isConnected, fileId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const retryConnection = () => {
    wsClient.connect();
    setTimeout(() => setIsConnected(wsClient.isConnected()), 1500);
  };

  // ── Trigger button ────────────────────────────────────────────────────────
  if (!isOpen) {
    return (
      <button
        className="floating-chat-button"
        onClick={() => setIsOpen(true)}
        aria-label="Open AI Assistant"
      >
        <MessageCircle size={18} />
        AI Assistant
      </button>
    );
  }

  // ── Chat widget ───────────────────────────────────────────────────────────
  return (
    <div className={`floating-chat-widget${isMinimized ? ' minimized' : ''}`}>

      {/* Header */}
      <div className="chat-widget-header">
        <div className="chat-widget-title">
          <div className="ai-avatar">
            <Bot size={18} />
          </div>
          <div>
            <h3>AI Assistant</h3>
            <span className={`chat-widget-status ${isConnected ? 'connected' : 'disconnected'}`}>
              <span className={`status-dot${isConnected ? ' pulse' : ''}`} />
              {isConnected ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>

        <div className="chat-widget-actions">
          <button
            className="chat-action-btn"
            onClick={() => setIsMinimized(!isMinimized)}
            title={isMinimized ? 'Expand' : 'Minimize'}
            aria-label={isMinimized ? 'Expand' : 'Minimize'}
          >
            <Minus size={13} />
          </button>
          <button
            className="chat-action-btn"
            onClick={() => setIsOpen(false)}
            title="Close"
            aria-label="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Disconnected state */}
          {!isConnected ? (
            <div className="chat-widget-error">
              <div className="error-icon-wrapper">
                <WifiOff size={40} />
              </div>
              <h4>Backend not connected</h4>
              <p className="error-help">Make sure the backend is running on port 4000</p>
              <button className="btn-retry-small" onClick={retryConnection}>
                <RefreshCw size={13} />
                Retry connection
              </button>
            </div>
          ) : (
            <>
              {/* Messages */}
              <div className="chat-widget-messages">
                {messages.length === 0 && (
                  <div className="chat-widget-welcome">
                    <div className="welcome-icon-wrapper">
                      <Sparkles size={26} />
                    </div>
                    <h3>Ready to analyze</h3>
                    <p>
                      {dataCount > 0
                        ? <>Analyzing <strong>{dataCount.toLocaleString()}</strong> {isConsoleMode ? 'log entries' : 'network requests'}</>
                        : `Ask me about your ${isConsoleMode ? 'console logs' : 'HAR file'}`}
                    </p>
                    <p className="help-text">
                      {isConsoleMode
                        ? 'I can help identify errors, warnings and patterns'
                        : 'I can help with performance, errors and specific requests'}
                    </p>

                    <p className="quick-questions-label">Suggested questions</p>
                    <div className="quick-questions">
                      {quickQuestions.map((q, i) => (
                        <button
                          key={i}
                          className="quick-question-btn"
                          onClick={() => { setInput(q); textareaRef.current?.focus(); }}
                        >
                          <Zap size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`chat-message chat-message-${message.role}`}
                  >
                    <div className="chat-message-avatar">
                      {message.role === 'user'
                        ? <User size={14} />
                        : <Bot size={14} />
                      }
                    </div>
                    <div className="chat-message-bubble">
                      {message.role === 'assistant' ? (
                        <>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                          </ReactMarkdown>
                          {message.isStreaming && (
                            <div className="chat-typing" style={{ marginTop: 6 }}>
                              <span /><span /><span />
                            </div>
                          )}
                        </>
                      ) : (
                        <p style={{ margin: 0 }}>{message.content}</p>
                      )}
                    </div>
                  </div>
                ))}

                {/* Typing indicator while waiting for first token */}
                {isLoading && !messages[messages.length - 1]?.isStreaming && (
                  <div className="chat-message chat-message-assistant">
                    <div className="chat-message-avatar">
                      <Bot size={14} />
                    </div>
                    <div className="chat-message-bubble">
                      <div className="chat-typing">
                        <span /><span /><span />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="chat-widget-input">
                <textarea
                  ref={textareaRef}
                  className="chat-widget-textarea"
                  placeholder={`Ask about ${isConsoleMode ? 'these logs' : 'this HAR file'}...`}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  disabled={isLoading}
                  aria-label="Message input"
                />
                <button
                  className="chat-widget-send"
                  onClick={sendMessage}
                  disabled={isLoading || !input.trim()}
                  aria-label="Send message"
                  title="Send (Enter)"
                >
                  <Send size={16} />
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default FloatingAiChat;
