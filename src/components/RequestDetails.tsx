// src/components/RequestDetails.tsx
import React, { useState } from 'react';
import { Entry } from '../types/har';
import { HarAnalyzer } from '../utils/harAnalyzer';
import { formatBytes, formatTime } from '../utils/formatters';

interface RequestDetailsProps {
    entry: Entry;
    onClose: () => void;
}

type TabType = 'request' | 'response' | 'headers' | 'cookies' | 'timing';

const RequestDetails: React.FC<RequestDetailsProps> = ({ entry, onClose }) => {
    const [activeTab, setActiveTab] = useState<TabType>('request');
    const [copied, setCopied] = useState(false);

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    const formatRequestForCopy = (): string => {
        let output = '';
        output += `URL: ${entry.request.url}\n`;
        output += `Method: ${entry.request.method}\n`;
        output += `HTTP Version: ${entry.request.httpVersion}\n`;
        output += `Started: ${new Date(entry.startedDateTime).toLocaleString()}\n`;

        if (entry.request.queryString.length > 0) {
            output += '\nQuery Parameters:\n';
            entry.request.queryString.forEach(param => {
                output += `  ${param.name}: ${param.value}\n`;
            });
        }

        if (entry.request.postData) {
            output += `\nPOST Data MIME Type: ${entry.request.postData.mimeType}\n`;
        }

        return output;
    };

    const formatResponseForCopy = (): string => {
        let output = '';
        output += `Status: ${entry.response.status} ${entry.response.statusText}\n`;
        output += `Content Type: ${entry.response.content.mimeType}\n`;
        output += `Size: ${formatBytes(entry.response.content.size)}\n`;
        if (entry.response.content.compression) {
            output += `Compression: ${formatBytes(entry.response.content.compression)} saved\n`;
        }
        return output;
    };

    const formatHeadersForCopy = (): string => {
        let output = 'Request Headers:\n';
        entry.request.headers.forEach(header => {
            output += `  ${header.name}: ${header.value}\n`;
        });

        output += '\nResponse Headers:\n';
        entry.response.headers.forEach(header => {
            output += `  ${header.name}: ${header.value}\n`;
        });

        return output;
    };

    const formatCookiesForCopy = (): string => {
        let output = '';

        if (entry.request.cookies.length > 0) {
            output += 'Request Cookies:\n';
            entry.request.cookies.forEach(cookie => {
                output += `  ${cookie.name}: ${cookie.value}\n`;
            });
        }

        if (entry.response.cookies.length > 0) {
            output += '\nResponse Cookies:\n';
            entry.response.cookies.forEach(cookie => {
                output += `  ${cookie.name}: ${cookie.value}\n`;
            });
        }

        return output || 'No cookies';
    };

    const formatTimingForCopy = (): string => {
        const timingBreakdown = HarAnalyzer.getTimingBreakdown(entry);
        const totalTime = HarAnalyzer.calculateTotalTime(entry.timings);

        let output = 'Timing Breakdown:\n';
        Object.entries(timingBreakdown).forEach(([phase, time]) => {
            output += `  ${phase.charAt(0).toUpperCase() + phase.slice(1)}: ${formatTime(time)}\n`;
        });
        output += `\nTotal: ${formatTime(totalTime)}`;

        return output;
    };

    const getCopyContent = (): string => {
        switch (activeTab) {
            case 'request':
                return formatRequestForCopy();
            case 'response':
                return formatResponseForCopy();
            case 'headers':
                return formatHeadersForCopy();
            case 'cookies':
                return formatCookiesForCopy();
            case 'timing':
                return formatTimingForCopy();
            default:
                return '';
        }
    };

    // src/components/RequestDetails.tsx - Update renderRequest function
    const renderRequest = () => (
        <div className="details-section">
            <div className="section-header">
                <h4>General</h4>
                <button
                    className={`btn-copy ${copied ? 'copied' : ''}`}
                    onClick={() => copyToClipboard(getCopyContent())}
                    title="Copy to clipboard"
                >
                    {copied ? '✓ Copied' : '📋 Copy'}
                </button>
            </div>

            <div className="request-general-info">
                <div className="info-row">
                    <span className="info-label">URL:</span>
                    <div className="info-value url-value">{entry.request.url}</div>
                </div>
                <div className="info-row">
                    <span className="info-label">Method:</span>
                    <div className="info-value">{entry.request.method}</div>
                </div>
                <div className="info-row">
                    <span className="info-label">HTTP Version:</span>
                    <div className="info-value">{entry.request.httpVersion}</div>
                </div>
                <div className="info-row">
                    <span className="info-label">Started:</span>
                    <div className="info-value">{new Date(entry.startedDateTime).toLocaleString()}</div>
                </div>
            </div>

            {entry.request.queryString.length > 0 && (
                <>
                    <h4>Query Parameters</h4>
                    <table className="details-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entry.request.queryString.map((param, index) => (
                                <tr key={index}>
                                    <td className="header-name">{param.name}</td>
                                    <td className="header-value">{param.value}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}

            {entry.request.postData && (
                <>
                    <h4>POST Data</h4>
                    <p><strong>MIME Type:</strong> {entry.request.postData.mimeType}</p>
                    {entry.request.postData.text && (
                        <pre className="post-data">{entry.request.postData.text}</pre>
                    )}
                </>
            )}
        </div>
    );


    // src/components/RequestDetails.tsx - Update renderResponse function
    const renderResponse = () => (
        <div className="details-section">
            <div className="section-header">
                <h4>Response Info</h4>
                <button
                    className={`btn-copy ${copied ? 'copied' : ''}`}
                    onClick={() => copyToClipboard(getCopyContent())}
                    title="Copy to clipboard"
                >
                    {copied ? '✓ Copied' : '📋 Copy'}
                </button>
            </div>

            <div className="request-general-info">
                <div className="info-row">
                    <span className="info-label">Status:</span>
                    <div className="info-value">{entry.response.status} {entry.response.statusText}</div>
                </div>
                <div className="info-row">
                    <span className="info-label">Content Type:</span>
                    <div className="info-value">{entry.response.content.mimeType}</div>
                </div>
                <div className="info-row">
                    <span className="info-label">Size:</span>
                    <div className="info-value">{formatBytes(entry.response.content.size)}</div>
                </div>
                {entry.response.content.compression && (
                    <div className="info-row">
                        <span className="info-label">Compression:</span>
                        <div className="info-value">{formatBytes(entry.response.content.compression)} saved</div>
                    </div>
                )}
            </div>

            {entry.response.content.text && (
                <>
                    <h4>Content Preview</h4>
                    <pre className="content-preview">
                        {entry.response.content.encoding === 'base64'
                            ? '[Base64 encoded content]'
                            : entry.response.content.text.substring(0, 5000)}
                    </pre>
                </>
            )}
        </div>
    );


    const renderHeaders = () => (
        <div className="details-section">
            <div className="section-header">
                <h4>Request Headers</h4>
                <button
                    className={`btn-copy ${copied ? 'copied' : ''}`}
                    onClick={() => copyToClipboard(getCopyContent())}
                    title="Copy to clipboard"
                >
                    {copied ? '✓ Copied' : 'Copy'}
                </button>
            </div>

            <table className="details-table">
                <tbody>
                    {entry.request.headers.map((header, index) => (
                        <tr key={index}>
                            <td className="header-name">{header.name}</td>
                            <td className="header-value">{header.value}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <h4 style={{ marginTop: '24px' }}>Response Headers</h4>
            <table className="details-table">
                <tbody>
                    {entry.response.headers.map((header, index) => (
                        <tr key={index}>
                            <td className="header-name">{header.name}</td>
                            <td className="header-value">{header.value}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );

    const renderCookies = () => (
        <div className="details-section">
            <div className="section-header">
                <h4>Cookies</h4>
                <button
                    className={`btn-copy ${copied ? 'copied' : ''}`}
                    onClick={() => copyToClipboard(getCopyContent())}
                    title="Copy to clipboard"
                >
                    {copied ? '✓ Copied' : 'Copy'}
                </button>
            </div>

            {entry.request.cookies.length > 0 && (
                <>
                    <h5>Request Cookies</h5>
                    <table className="details-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Value</th>
                                <th>Domain</th>
                                <th>Path</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entry.request.cookies.map((cookie, index) => (
                                <tr key={index}>
                                    <td>{cookie.name}</td>
                                    <td>{cookie.value}</td>
                                    <td>{cookie.domain || 'N/A'}</td>
                                    <td>{cookie.path || 'N/A'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}

            {entry.response.cookies.length > 0 && (
                <>
                    <h5 style={{ marginTop: '20px' }}>Response Cookies</h5>
                    <table className="details-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Value</th>
                                <th>Domain</th>
                                <th>Path</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entry.response.cookies.map((cookie, index) => (
                                <tr key={index}>
                                    <td>{cookie.name}</td>
                                    <td>{cookie.value}</td>
                                    <td>{cookie.domain || 'N/A'}</td>
                                    <td>{cookie.path || 'N/A'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}

            {entry.request.cookies.length === 0 && entry.response.cookies.length === 0 && (
                <p className="no-data">No cookies</p>
            )}
        </div>
    );

    const renderTiming = () => {
        const timingBreakdown = HarAnalyzer.getTimingBreakdown(entry);
        const totalTime = HarAnalyzer.calculateTotalTime(entry.timings);

        return (
            <div className="details-section">
                <div className="section-header">
                    <h4>Timing Breakdown</h4>
                    <button
                        className={`btn-copy ${copied ? 'copied' : ''}`}
                        onClick={() => copyToClipboard(getCopyContent())}
                        title="Copy to clipboard"
                    >
                        {copied ? '✓ Copied' : 'Copy'}
                    </button>
                </div>

                <div className="timing-details">
                    {Object.entries(timingBreakdown).map(([phase, time]) => (
                        <div key={phase} className="timing-row">
                            <span className="timing-label">{phase.charAt(0).toUpperCase() + phase.slice(1)}</span>
                            <span className="timing-value">{formatTime(time)}</span>
                            <div className="timing-bar-container">
                                <div
                                    className={`timing-bar-fill timing-${phase}`}
                                    style={{ width: `${(time / totalTime) * 100}%` }}
                                />
                            </div>
                        </div>
                    ))}
                </div>

                <div className="timing-explanation">
                    <h5>Timing Phases:</h5>
                    <ul>
                        <li><strong>Blocked:</strong> Time spent waiting in queue</li>
                        <li><strong>DNS:</strong> DNS lookup time</li>
                        <li><strong>Connect:</strong> TCP connection establishment</li>
                        <li><strong>SSL:</strong> SSL/TLS negotiation</li>
                        <li><strong>Send:</strong> Time to send request</li>
                        <li><strong>Wait:</strong> Waiting for server response (TTFB)</li>
                        <li><strong>Receive:</strong> Time to download response</li>
                    </ul>
                </div>
            </div>
        );
    };

    return (
        <div className="request-details">
            <div className="details-header">
                <h3>Request Details</h3>
                <button className="btn-close" onClick={onClose}>×</button>
            </div>

            <div className="details-tabs">
                <button className={`tab ${activeTab === 'request' ? 'active' : ''}`} onClick={() => setActiveTab('request')}>
                    Request
                </button>
                <button className={`tab ${activeTab === 'response' ? 'active' : ''}`} onClick={() => setActiveTab('response')}>
                    Response
                </button>
                <button className={`tab ${activeTab === 'headers' ? 'active' : ''}`} onClick={() => setActiveTab('headers')}>
                    Headers
                </button>
                <button className={`tab ${activeTab === 'cookies' ? 'active' : ''}`} onClick={() => setActiveTab('cookies')}>
                    Cookies
                </button>
                <button className={`tab ${activeTab === 'timing' ? 'active' : ''}`} onClick={() => setActiveTab('timing')}>
                    Timing
                </button>
            </div>

            <div className="details-content">
                {activeTab === 'request' && renderRequest()}
                {activeTab === 'response' && renderResponse()}
                {activeTab === 'headers' && renderHeaders()}
                {activeTab === 'cookies' && renderCookies()}
                {activeTab === 'timing' && renderTiming()}
            </div>
        </div>
    );
};

export default RequestDetails;
