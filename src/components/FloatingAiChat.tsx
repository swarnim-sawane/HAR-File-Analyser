// src/components/FloatingAiChat.tsx
import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { HarFile } from '../types/har';
import './FloatingAiChat.css';


interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface FloatingAiChatProps {
  harData: HarFile;
}

const FloatingAiChat: React.FC<FloatingAiChatProps> = ({ harData }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [ollamaConnected, setOllamaConnected] = useState<boolean>(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      checkOllama();
    }
  }, [isOpen]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const checkOllama = async () => {
    try {
      const response = await fetch('http://localhost:11435/api/tags');
      setOllamaConnected(response.ok);
    } catch {
      setOllamaConnected(false);
    }
  };

  const getHarSummary = () => {
    const entries = harData.log.entries;
    const totalRequests = entries.length;
    const totalSize = entries.reduce((sum, e) => sum + e.response.bodySize, 0);
    const totalTime = entries.reduce((sum, e) => sum + e.time, 0);
    const domains = [...new Set(entries.map(e => {
      try {
        return new URL(e.request.url).hostname;
      } catch {
        return 'unknown';
      }
    }))];
    const errorCount = entries.filter(e => e.response.status >= 400).length;

    return `HAR File Context:
- Total Requests: ${totalRequests}
- Total Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB
- Total Time: ${(totalTime / 1000).toFixed(2)} seconds
- Unique Domains: ${domains.length}
- Failed Requests: ${errorCount}`;
  };

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
      const harSummary = getHarSummary();
      
      const systemPrompt = `You are a helpful HAR file analyzer assistant. You're analyzing a HAR (HTTP Archive) file with the following information:

${harSummary}

Answer the user's questions about this HAR file. Be concise and specific. If they paste a URL, analyze that specific request. Format your responses using markdown for better readability.`;

      const response = await fetch('http://localhost:11435/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3.2',
          prompt: `${systemPrompt}\n\nUser: ${input}\n\nAssistant:`,
          stream: true,
          options: {
            temperature: 0.7,
            num_predict: 400,
          },
        }),
      });

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

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n').filter(line => line.trim());

          for (const line of lines) {
            try {
              const json = JSON.parse(line);
              if (json.response) {
                assistantMessage.content += json.response;
                setMessages(prev => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1] = { ...assistantMessage };
                  return newMessages;
                });
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '❌ Failed to get response. Make sure Ollama is running.',
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

  const quickQuestions = [
    'Show slowest requests',
    'Any errors?',
    'Performance issues?',
  ];

  if (!isOpen) {
    return (
      <button className="floating-chat-button" onClick={() => setIsOpen(true)}>
        <svg className="chat-icon-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12C2 13.54 2.38 14.99 3.06 16.26L2 22L7.74 20.94C9.01 21.62 10.46 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2Z" fill="currentColor"/>
          <circle cx="8" cy="12" r="1.5" fill="white"/>
          <circle cx="12" cy="12" r="1.5" fill="white"/>
          <circle cx="16" cy="12" r="1.5" fill="white"/>
        </svg>
        <span className="chat-label">AI Assistant</span>
      </button>
    );
  }

  return (
    <div className={`floating-chat-widget ${isMinimized ? 'minimized' : ''}`}>
      <div className="chat-widget-header">
        <div className="chat-widget-title">
          <div className="ai-avatar">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" opacity="0.3"/>
              <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <h3>AI Assistant</h3>
            {ollamaConnected && (
              <span className="chat-widget-status">
                <span className="status-indicator"></span>
                Online
              </span>
            )}
          </div>
        </div>
        <div className="chat-widget-actions">
          <button
            className="chat-action-btn"
            onClick={() => setIsMinimized(!isMinimized)}
            title={isMinimized ? 'Expand' : 'Minimize'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              {isMinimized ? (
                <rect x="3" y="3" width="10" height="10" stroke="currentColor" strokeWidth="2"/>
              ) : (
                <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="2"/>
              )}
            </svg>
          </button>
          <button
            className="chat-action-btn"
            onClick={() => setIsOpen(false)}
            title="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {!ollamaConnected ? (
            <div className="chat-widget-error">
              <div className="error-icon-wrapper">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                  <path d="M12 8V12M12 16H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <h4>Ollama Not Connected</h4>
              <p className="error-help">Run: <code>ollama pull llama3.2</code></p>
              <button className="btn-retry-small" onClick={checkOllama}>
                Retry Connection
              </button>
            </div>
          ) : (
            <>
              <div className="chat-widget-messages">
                {messages.length === 0 && (
                  <div className="chat-widget-welcome">
                    <div className="welcome-icon-wrapper">
                      <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                        <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" opacity="0.2"/>
                        <path d="M2 17L12 22L22 17M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                    </div>
                    <h3>Welcome! 👋</h3>
                    <p>I'm analyzing your HAR file with <strong>{harData.log.entries.length}</strong> requests.</p>
                    <p className="help-text">Ask me about performance, errors, or any specific requests.</p>
                    <div className="quick-questions">
                      {quickQuestions.map((q, i) => (
                        <button
                          key={i}
                          className="quick-question-btn"
                          onClick={() => {
                            setInput(q);
                            textareaRef.current?.focus();
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M8 3V13M13 8H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                          </svg>
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((message) => (
                  <div key={message.id} className={`chat-message chat-message-${message.role}`}>
                    <div className="chat-message-avatar">
                      {message.role === 'user' ? (
                        <svg viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="8" r="4" fill="currentColor"/>
                          <path d="M6 21C6 17.6863 8.68629 15 12 15C15.3137 15 18 17.6863 18 21" stroke="currentColor" strokeWidth="2"/>
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none">
                          <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" opacity="0.3"/>
                          <path d="M2 17L12 22L22 17M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2"/>
                        </svg>
                      )}
                    </div>
                    <div className="chat-message-bubble">
                      {message.role === 'assistant' ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                      ) : (
                        message.content
                      )}
                    </div>
                  </div>
                ))}

                {isLoading && (
                  <div className="chat-message chat-message-assistant">
                    <div className="chat-message-avatar">
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" opacity="0.3"/>
                        <path d="M2 17L12 22L22 17M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                    </div>
                    <div className="chat-message-bubble">
                      <div className="chat-typing">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              <div className="chat-widget-input">
                <textarea
                  ref={textareaRef}
                  className="chat-widget-textarea"
                  placeholder="Ask about your HAR file..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  rows={1}
                  disabled={isLoading}
                />
                <button
                  className="chat-widget-send"
                  onClick={sendMessage}
                  disabled={isLoading || !input.trim()}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
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
