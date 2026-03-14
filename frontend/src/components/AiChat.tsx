// src/components/AiChat.tsx
import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { HarFile } from '../shared/types/har';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface AiChatProps {
  harData: HarFile;
}

const AiChat: React.FC<AiChatProps> = ({ harData }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [ollamaConnected, setOllamaConnected] = useState<boolean | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    checkOllama();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // ✅ Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const checkOllama = async () => {
    try {
      const response = await fetch('http://localhost:11435/api/tags');
      setOllamaConnected(response.ok);
      
      if (response.ok) {
        console.log('✅ Ollama connected successfully');
      } else {
        console.warn('⚠️ Ollama responded but not OK');
      }
    } catch (error) {
      console.error('❌ Ollama connection failed:', error);
      setOllamaConnected(false);
    }
  };

  const getHarSummary = () => {
    const entries = harData.log.entries;
    const totalRequests = entries.length;
    const totalSize = entries.reduce((sum, e) => sum + (e.response.bodySize || 0), 0);
    const totalTime = entries.reduce((sum, e) => sum + (e.time || 0), 0);
    const domains = [...new Set(entries.map(e => {
      try {
        return new URL(e.request.url).hostname;
      } catch {
        return 'unknown';
      }
    }))];
    const errorCount = entries.filter(e => e.response.status >= 400).length;
    const slowRequests = entries.filter(e => e.time > 1000).length;
    const methods = [...new Set(entries.map(e => e.request.method))];

    return `HAR File Analysis:
- Total Requests: ${totalRequests}
- Total Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB
- Total Load Time: ${(totalTime / 1000).toFixed(2)} seconds
- Unique Domains: ${domains.length} (${domains.slice(0, 5).join(', ')}${domains.length > 5 ? '...' : ''})
- HTTP Methods: ${methods.join(', ')}
- Failed Requests (4xx/5xx): ${errorCount}
- Slow Requests (>1s): ${slowRequests}`;
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

      const systemPrompt = `You are an expert HAR file analyzer. You're analyzing network traffic with the following data:

${harSummary}

Answer questions concisely and provide actionable insights. Format responses with:
- **Bold** for important metrics
- \`code\` for URLs and technical terms
- Lists for multiple items
- Be specific and reference actual data`;

      const response = await fetch('http://localhost:11435/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3.2',
          prompt: `${systemPrompt}\n\nUser: ${input}\n\nAssistant:`,
          stream: true,
          options: {
            temperature: 0.7,
            top_p: 0.9,
            num_predict: 500,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      let assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
      };

      setMessages(prev => [...prev, assistantMessage]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Mark streaming as complete
            setMessages(prev => {
              const updated = [...prev];
              const lastMsg = updated[updated.length - 1];
              if (lastMsg) {
                lastMsg.isStreaming = false;
              }
              return updated;
            });
            break;
          }

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
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ Error sending message:', error);
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '❌ **Failed to get response**\n\nMake sure:\n1. Ollama is running on port 11435\n2. The `llama3.2` model is installed\n3. Run: `ollama pull llama3.2`',
        timestamp: new Date(),
        isStreaming: false,
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

  const suggestedQuestions = [
    'What are the slowest requests?',
    'Show me all failed requests',
    'Which domains load the most data?',
    'Are there any performance bottlenecks?',
    'What file types are being loaded?',
    'Analyze caching strategy',
  ];

  // ✅ Loading state
  if (ollamaConnected === null) {
    return (
      <div className="ai-chat">
        <div className="chat-loading">
          <div className="loading-spinner">
            <svg className="spinner-icon" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25" />
              <path d="M12 2C6.47 2 2 6.47 2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <h3>Connecting to Ollama...</h3>
          <p className="loading-subtext">Checking AI service availability</p>
        </div>
      </div>
    );
  }

  // ✅ Setup instructions
  if (ollamaConnected === false) {
    return (
      <div className="ai-chat">
        <div className="chat-setup">
          <div className="setup-icon-wrapper">
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" opacity="0.2" />
              <path d="M2 17L12 22L22 17M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" />
              <circle cx="17" cy="7" r="3" fill="#ef4444" stroke="white" strokeWidth="2" />
            </svg>
          </div>
          <h2>AI Analysis Unavailable</h2>
          <p className="setup-subtitle">Ollama is not running on your system</p>
          
          <div className="setup-steps">
            <div className="setup-step">
              <div className="step-number">1</div>
              <div className="step-content">
                <h4>Install Ollama</h4>
                <code className="setup-code">curl -fsSL https://ollama.com/install.sh | sh</code>
                <p className="step-help">Or download from <a href="https://ollama.com" target="_blank" rel="noopener noreferrer">ollama.com</a></p>
              </div>
            </div>
            
            <div className="setup-step">
              <div className="step-number">2</div>
              <div className="step-content">
                <h4>Download AI Model</h4>
                <code className="setup-code">ollama pull llama3.2</code>
                <p className="step-help">This will download the Llama 3.2 model (~2GB)</p>
              </div>
            </div>
            
            <div className="setup-step">
              <div className="step-number">3</div>
              <div className="step-content">
                <h4>Verify Installation</h4>
                <code className="setup-code">ollama list</code>
                <p className="step-help">Check if llama3.2 appears in the list</p>
              </div>
            </div>
          </div>

          <button className="btn-retry" onClick={checkOllama}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M21 12C21 7.03 16.97 3 12 3M3 12C3 16.97 7.03 21 12 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  // ✅ Main chat interface
  return (
    <div className="ai-chat">
      <div className="chat-header">
        <div className="chat-header-info">
          <div className="chat-header-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" opacity="0.3" />
              <path d="M2 17L12 22L22 17M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
          <div>
            <h2>AI Assistant</h2>
            <p className="chat-subtitle">Powered by Ollama (Llama 3.2)</p>
          </div>
        </div>
        <div className="chat-status connected">
          <span className="status-indicator"></span>
          <span className="status-text">Connected</span>
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <div className="welcome-icon-wrapper">
              <svg width="80" height="80" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" opacity="0.2" />
                <path d="M2 17L12 22L22 17M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" />
              </svg>
            </div>
            <h3>Welcome to HAR Analysis! 👋</h3>
            <p className="welcome-description">
              I've analyzed your HAR file with <strong>{harData.log.entries.length.toLocaleString()}</strong> network requests.
            </p>
            <p className="welcome-help">
              Ask me about performance, errors, optimization opportunities, or anything else about your network traffic.
            </p>

            <div className="suggested-questions">
              <h4 className="suggested-title">💡 Suggested Questions:</h4>
              <div className="question-grid">
                {suggestedQuestions.map((q, i) => (
                  <button
                    key={i}
                    className="question-btn"
                    onClick={() => {
                      setInput(q);
                      textareaRef.current?.focus();
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M8 3V13M13 8H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <span>{q}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={`message message-${message.role}`}>
            <div className="message-avatar">
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
            <div className="message-bubble">
              {message.role === 'assistant' ? (
                <div className="message-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                  {message.isStreaming && (
                    <span className="streaming-cursor">▊</span>
                  )}
                </div>
              ) : (
                <p className="message-text">{message.content}</p>
              )}
              <div className="message-time">
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}

        {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="message message-assistant">
            <div className="message-avatar">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" opacity="0.3" />
                <path d="M2 17L12 22L22 17M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" />
              </svg>
            </div>
            <div className="message-bubble">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-container">
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder="Ask anything about your HAR file..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          rows={1}
          disabled={isLoading}
          aria-label="Message input"
        />
        <button
          className="chat-send-btn"
          onClick={sendMessage}
          disabled={isLoading || !input.trim()}
          aria-label="Send message"
          title="Send message (Enter)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default AiChat;
