// src/components/AiChat.tsx
import React, { useState, useRef, useEffect } from 'react';
import { HarFile } from '../types/har';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
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
    const slowRequests = entries.filter(e => e.time > 1000).length;

    return `HAR File Summary:
- Total Requests: ${totalRequests}
- Total Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB
- Total Load Time: ${(totalTime / 1000).toFixed(2)} seconds
- Unique Domains: ${domains.length} (${domains.slice(0, 5).join(', ')}${domains.length > 5 ? '...' : ''})
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
      
      const systemPrompt = `You are a helpful HAR file analyzer assistant. You're analyzing a HAR (HTTP Archive) file with the following information:

${harSummary}

Answer the user's questions about this HAR file. Be concise, helpful, and specific. If you need more details about specific requests, let the user know they can ask follow-up questions.`;

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
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      console.error('Error:', error);
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '❌ Failed to get response. Make sure Ollama is running with llama3.2 model.',
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

  const suggestedQuestions = [
    'What are the slowest requests?',
    'Show me failed requests',
    'Which domains are used?',
    'What is the total page size?',
    'Are there any performance issues?',
  ];

  if (ollamaConnected === null) {
    return (
      <div className="ai-chat">
        <div className="chat-loading">
          <div className="spinner"></div>
          <p>Checking Ollama connection...</p>
        </div>
      </div>
    );
  }

  if (ollamaConnected === false) {
    return (
      <div className="ai-chat">
        <div className="chat-setup">
          <div className="setup-icon">🤖</div>
          <h2>AI Chat Not Available</h2>
          <p>Ollama is not running. To use AI analysis:</p>
          <ol>
            <li>Install Ollama: <code>curl -fsSL https://ollama.com/install.sh | sh</code></li>
            <li>Pull model: <code>ollama pull llama3.2</code></li>
            <li>Ollama should start automatically</li>
          </ol>
          <button className="btn-retry" onClick={checkOllama}>
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-chat">
      <div className="chat-header">
        <div className="chat-header-info">
          <h2>🤖 AI Assistant</h2>
          <p>Ask questions about your HAR file</p>
        </div>
        <div className="chat-status">
          <span className="status-dot"></span>
          <span>Ollama Connected</span>
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <div className="welcome-icon">👋</div>
            <h3>Welcome! I'm your HAR Analysis Assistant</h3>
            <p>I've analyzed your HAR file with {harData.log.entries.length} requests.</p>
            <p>Ask me anything about network performance, errors, or optimization opportunities.</p>
            
            <div className="suggested-questions">
              <h4>Try asking:</h4>
              <div className="question-buttons">
                {suggestedQuestions.map((q, i) => (
                  <button
                    key={i}
                    className="question-btn"
                    onClick={() => {
                      setInput(q);
                      textareaRef.current?.focus();
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={`message message-${message.role}`}>
            <div className="message-avatar">
              {message.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="message-content">
              <div className="message-text">{message.content}</div>
              <div className="message-time">
                {message.timestamp.toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="message message-assistant">
            <div className="message-avatar">🤖</div>
            <div className="message-content">
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
          placeholder="Ask about your HAR file..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          rows={1}
          disabled={isLoading}
        />
        <button
          className="chat-send-btn"
          onClick={sendMessage}
          disabled={isLoading || !input.trim()}
        >
          {isLoading ? '⏳' : '➤'}
        </button>
      </div>
    </div>
  );
};

export default AiChat;
