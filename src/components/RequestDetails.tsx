// src/components/RequestDetails.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Entry } from '../types/har';
import { HarAnalyzer } from '../utils/harAnalyzer';
import { formatBytes, formatCapturedDate, formatTime } from '../utils/formatters';
import type { RequestFlowFocusPath, RequestFlowNextInspection } from '../utils/requestFlowFocus';

interface RequestDetailsProps {
    entry: Entry;
    onClose: () => void;
    focusPath?: RequestFlowFocusPath | null;
    searchTerm?: string;
}

type TabType = 'request' | 'response' | 'response headers' | 'request headers' | 'cookies' | 'timing';

interface DetailSearchField {
    tab: TabType;
    id: string;
    value: string;
}

interface DetailSearchOccurrence {
    id: string;
    tab: TabType;
}

interface TextOccurrence {
    start: number;
    end: number;
}

const DETAIL_TABS: Array<{ id: TabType; label: string }> = [
    { id: 'request', label: 'Request' },
    { id: 'response', label: 'Response' },
    { id: 'request headers', label: 'Request Headers' },
    { id: 'response headers', label: 'Response Headers' },
    { id: 'cookies', label: 'Cookies' },
    { id: 'timing', label: 'Timing' },
];

function findTextOccurrences(value: string, patterns: string[]): TextOccurrence[] {
    const normalizedValue = value.toLocaleLowerCase();
    const candidates: TextOccurrence[] = [];

    patterns.forEach((pattern) => {
        const normalizedPattern = pattern.toLocaleLowerCase();
        if (!normalizedPattern) return;

        let start = normalizedValue.indexOf(normalizedPattern);
        while (start >= 0) {
            candidates.push({ start, end: start + normalizedPattern.length });
            start = normalizedValue.indexOf(normalizedPattern, start + Math.max(1, normalizedPattern.length));
        }
    });

    candidates.sort((left, right) => left.start - right.start || right.end - right.start - (left.end - left.start));

    return candidates.reduce<TextOccurrence[]>((occurrences, candidate) => {
        const previous = occurrences[occurrences.length - 1];
        if (previous && candidate.start < previous.end) return occurrences;
        occurrences.push(candidate);
        return occurrences;
    }, []);
}

function resolveSearchPatterns(searchTerm: string, fields: DetailSearchField[]): string[] {
    const query = searchTerm.trim();
    if (!query) return [];

    const normalizedQuery = query.toLocaleLowerCase();
    if (fields.some((field) => field.value.toLocaleLowerCase().includes(normalizedQuery))) {
        return [query];
    }

    return Array.from(new Set(query.split(/\s+/).map((token) => token.trim()).filter(Boolean)))
        .sort((left, right) => right.length - left.length);
}

function getSearchAwarePreview(text: string, searchTerm: string, maxLength = 5000): string {
    if (text.length <= maxLength) return text;

    const queryParts = [searchTerm.trim(), ...searchTerm.trim().split(/\s+/)]
        .filter(Boolean)
        .sort((left, right) => right.length - left.length);
    const normalizedText = text.toLocaleLowerCase();
    const firstMatch = queryParts.reduce<number>((best, part) => {
        const match = normalizedText.indexOf(part.toLocaleLowerCase());
        if (match < 0) return best;
        return best < 0 ? match : Math.min(best, match);
    }, -1);

    if (firstMatch < 0) return `${text.slice(0, maxLength)}\n...`;

    const start = Math.max(0, firstMatch - Math.floor(maxLength / 3));
    const end = Math.min(text.length, start + maxLength);
    return `${start > 0 ? '...\n' : ''}${text.slice(start, end)}${end < text.length ? '\n...' : ''}`;
}

interface HighlightedTextProps {
    value: string | number;
    tab: TabType;
    fieldId: string;
    patterns: string[];
    currentMatchId?: string;
}

const HighlightedText: React.FC<HighlightedTextProps> = ({
    value,
    tab,
    fieldId,
    patterns,
    currentMatchId,
}) => {
    const text = String(value);
    const occurrences = findTextOccurrences(text, patterns);
    if (occurrences.length === 0) return <>{text}</>;

    const nodes: React.ReactNode[] = [];
    let cursor = 0;

    occurrences.forEach((occurrence, index) => {
        if (occurrence.start > cursor) nodes.push(text.slice(cursor, occurrence.start));
        const matchId = `${tab}:${fieldId}:${index}`;
        nodes.push(
            <mark
                key={matchId}
                className={`details-search-match ${matchId === currentMatchId ? 'is-current' : ''}`}
                data-search-match-id={matchId}
            >
                {text.slice(occurrence.start, occurrence.end)}
            </mark>
        );
        cursor = occurrence.end;
    });

    if (cursor < text.length) nodes.push(text.slice(cursor));
    return <>{nodes}</>;
};

function getTabForInspection(nextInspection?: RequestFlowNextInspection): TabType {
    switch (nextInspection) {
        case 'headers':
            return 'response headers';
        case 'response':
        case 'preview':
            return 'response';
        case 'timings':
            return 'timing';
        case 'initiator':
        case 'general':
        default:
            return 'request';
    }
}

const RequestDetails: React.FC<RequestDetailsProps> = ({ entry, onClose, focusPath = null, searchTerm = '' }) => {
    const [activeTab, setActiveTab] = useState<TabType>(() => getTabForInspection(focusPath?.nextInspection));
    const [activeMatchIndex, setActiveMatchIndex] = useState(0);
    const [copied, setCopied] = useState(false);
    const detailsContentRef = useRef<HTMLDivElement>(null);
    const focusLabel = focusPath?.confidence === 'low' ? 'Worth checking' : 'Likely issue';
    const timingBreakdown = useMemo(() => HarAnalyzer.getTimingBreakdown(entry), [entry]);
    const totalTime = useMemo(() => HarAnalyzer.calculateTotalTime(entry.timings), [entry]);
    const responsePreviewText = useMemo(() => {
        const content = entry.response.content;
        if (!content?.text) return '';
        if (content.encoding === 'base64') return '[Base64 encoded content]';
        return getSearchAwarePreview(content.text, searchTerm);
    }, [entry, searchTerm]);
    const searchFields = useMemo<DetailSearchField[]>(() => {
        const fields: DetailSearchField[] = [];
        const add = (tab: TabType, id: string, value: unknown) => {
            if (value === null || value === undefined || value === '') return;
            fields.push({ tab, id, value: String(value) });
        };

        add('request', 'url', entry.request.url);
        add('request', 'method', entry.request.method);
        add('request', 'http-version', entry.request.httpVersion);
        add('request', 'started', formatCapturedDate(entry.startedDateTime));
        entry.request.queryString.forEach((parameter, index) => {
            add('request', `query-${index}-name`, parameter.name);
            add('request', `query-${index}-value`, parameter.value);
        });
        if (entry.request.postData) {
            add('request', 'post-mime', entry.request.postData.mimeType);
            add('request', 'post-text', entry.request.postData.text);
            entry.request.postData.params?.forEach((parameter, index) => {
                add('request', `post-param-${index}-name`, parameter.name);
                add('request', `post-param-${index}-value`, parameter.value);
                add('request', `post-param-${index}-file`, parameter.fileName);
                add('request', `post-param-${index}-type`, parameter.contentType);
            });
        }

        add('response', 'status', `${entry.response.status} ${entry.response.statusText}`);
        add('response', 'http-version', entry.response.httpVersion);
        add('response', 'redirect-url', entry.response.redirectURL);
        add('response', 'content-type', entry.response.content?.mimeType ?? '');
        add('response', 'size', formatBytes(entry.response.content?.size ?? 0));
        if (entry.response.content?.compression) {
            add('response', 'compression', `${formatBytes(entry.response.content.compression)} saved`);
        }
        add('response', 'content-preview', responsePreviewText);

        entry.request.headers.forEach((header, index) => {
            add('request headers', `request-header-${index}-name`, header.name);
            add('request headers', `request-header-${index}-value`, header.value);
        });
        entry.response.headers.forEach((header, index) => {
            add('response headers', `response-header-${index}-name`, header.name);
            add('response headers', `response-header-${index}-value`, header.value);
        });

        entry.request.cookies.forEach((cookie, index) => {
            add('cookies', `request-cookie-${index}-name`, cookie.name);
            add('cookies', `request-cookie-${index}-value`, cookie.value);
            add('cookies', `request-cookie-${index}-domain`, cookie.domain || 'N/A');
            add('cookies', `request-cookie-${index}-path`, cookie.path || 'N/A');
        });
        entry.response.cookies.forEach((cookie, index) => {
            add('cookies', `response-cookie-${index}-name`, cookie.name);
            add('cookies', `response-cookie-${index}-value`, cookie.value);
            add('cookies', `response-cookie-${index}-domain`, cookie.domain || 'N/A');
            add('cookies', `response-cookie-${index}-path`, cookie.path || 'N/A');
        });

        Object.entries(timingBreakdown).forEach(([phase, time]) => {
            add('timing', `timing-${phase}-name`, phase.charAt(0).toUpperCase() + phase.slice(1));
            add('timing', `timing-${phase}-value`, formatTime(time));
        });
        add('timing', 'timing-total', formatTime(totalTime));

        return fields;
    }, [entry, responsePreviewText, timingBreakdown, totalTime]);
    const searchPatterns = useMemo(
        () => resolveSearchPatterns(searchTerm, searchFields),
        [searchFields, searchTerm]
    );
    const searchOccurrences = useMemo<DetailSearchOccurrence[]>(
        () => searchFields.flatMap((field) =>
            findTextOccurrences(field.value, searchPatterns).map((_, index) => ({
                id: `${field.tab}:${field.id}:${index}`,
                tab: field.tab,
            }))
        ),
        [searchFields, searchPatterns]
    );
    const matchCountByTab = useMemo(() => {
        const counts = new Map<TabType, number>();
        searchOccurrences.forEach((match) => counts.set(match.tab, (counts.get(match.tab) ?? 0) + 1));
        return counts;
    }, [searchOccurrences]);
    const matchingSectionCount = matchCountByTab.size;
    const currentMatchIndex = searchOccurrences.length > 0
        ? Math.min(activeMatchIndex, searchOccurrences.length - 1)
        : 0;
    const currentMatch = searchOccurrences[currentMatchIndex];

    useEffect(() => {
        setActiveMatchIndex(0);
        setActiveTab(searchOccurrences[0]?.tab ?? getTabForInspection(focusPath?.nextInspection));
    }, [entry, focusPath?.nextInspection, searchTerm, searchOccurrences]);

    useEffect(() => {
        if (!currentMatch || currentMatch.tab !== activeTab) return;
        const timeout = window.setTimeout(() => {
            const matchElement = Array.from(
                detailsContentRef.current?.querySelectorAll<HTMLElement>('[data-search-match-id]') ?? []
            ).find((element) => element.dataset.searchMatchId === currentMatch.id);
            matchElement?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        }, 0);
        return () => window.clearTimeout(timeout);
    }, [activeTab, currentMatch]);

    const navigateToMatch = (direction: -1 | 1) => {
        if (searchOccurrences.length === 0) return;
        const nextIndex = (currentMatchIndex + direction + searchOccurrences.length) % searchOccurrences.length;
        setActiveMatchIndex(nextIndex);
        setActiveTab(searchOccurrences[nextIndex].tab);
    };

    const changeDetailsTab = (tab: TabType) => {
        setActiveTab(tab);
        const firstMatchIndex = searchOccurrences.findIndex((match) => match.tab === tab);
        if (firstMatchIndex >= 0) setActiveMatchIndex(firstMatchIndex);
    };

    const highlight = (value: string | number, tab: TabType, fieldId: string) => (
        <HighlightedText
            value={value}
            tab={tab}
            fieldId={fieldId}
            patterns={searchPatterns}
            currentMatchId={currentMatch?.id}
        />
    );

    const copyToClipboard = async (text: string) => {
    try {
        // Modern Clipboard API (works in HTTPS or localhost)
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } else {
            // Fallback for HTTP contexts
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                } else {
                    throw new Error('Copy command failed');
                }
            } catch (err) {
                console.error('Fallback: Failed to copy:', err);
            } finally {
                document.body.removeChild(textArea);
            }
        }
    } catch (err) {
        console.error('Failed to copy:', err);
    }
};

    const formatRequestForCopy = (): string => {
        let output = '';
        output += `URL: ${entry.request.url}\n`;
        output += `Method: ${entry.request.method}\n`;
        output += `HTTP Version: ${entry.request.httpVersion}\n`;
        output += `Started: ${formatCapturedDate(entry.startedDateTime)}\n`;

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
        // Guard against entries with no body (e.g. 304 Not Modified, 204 No Content)
        output += `Content Type: ${entry.response.content?.mimeType ?? ''}\n`;
        output += `Size: ${formatBytes(entry.response.content?.size ?? 0)}\n`;
        if (entry.response.content?.compression) {
            output += `Compression: ${formatBytes(entry.response.content.compression)} saved\n`;
        }
        return output;
    };

    const formatRequestHeadersForCopy = (): string => {
        let output = 'Request Headers:\n';
        entry.request.headers.forEach(header => {
            output += `  ${header.name}: ${header.value}\n`;
        });



        return output;
    };
    const formatResponseHeadersForCopy = (): string => {


        let output = 'Response Headers:\n';
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
            case 'request headers':
                return formatRequestHeadersForCopy();
            case 'response headers':
                return formatResponseHeadersForCopy();
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
                    {copied ? '✓ Copied' : ' Copy'}
                </button>
            </div>

            <div className="request-general-info">
                <div className="info-row">
                    <span className="info-label">URL:</span>
                    <div className="info-value url-value">{highlight(entry.request.url, 'request', 'url')}</div>
                </div>
                <div className="info-row">
                    <span className="info-label">Method:</span>
                    <div className="info-value">{highlight(entry.request.method, 'request', 'method')}</div>
                </div>
                <div className="info-row">
                    <span className="info-label">HTTP Version:</span>
                    <div className="info-value">{highlight(entry.request.httpVersion, 'request', 'http-version')}</div>
                </div>
                <div className="info-row">
                    <span className="info-label">Started:</span>
                    <div className="info-value">{highlight(formatCapturedDate(entry.startedDateTime), 'request', 'started')}</div>
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
                                    <td className="header-name">{highlight(param.name, 'request', `query-${index}-name`)}</td>
                                    <td className="header-value">{highlight(param.value, 'request', `query-${index}-value`)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}

            {entry.request.postData && (
                <>
                    <h4>POST Data</h4>
                    <p><strong>MIME Type:</strong> {highlight(entry.request.postData.mimeType, 'request', 'post-mime')}</p>
                    {entry.request.postData.params && entry.request.postData.params.length > 0 && (
                        <table className="details-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Value</th>
                                    <th>File</th>
                                    <th>Content Type</th>
                                </tr>
                            </thead>
                            <tbody>
                                {entry.request.postData.params.map((parameter, index) => (
                                    <tr key={`${parameter.name}-${index}`}>
                                        <td>{highlight(parameter.name, 'request', `post-param-${index}-name`)}</td>
                                        <td>{highlight(parameter.value ?? '', 'request', `post-param-${index}-value`)}</td>
                                        <td>{highlight(parameter.fileName ?? '', 'request', `post-param-${index}-file`)}</td>
                                        <td>{highlight(parameter.contentType ?? '', 'request', `post-param-${index}-type`)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {entry.request.postData.text && (
                        <pre className="post-data">{highlight(entry.request.postData.text, 'request', 'post-text')}</pre>
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
                    {copied ? '✓ Copied' : 'Copy'}
                </button>
            </div>

            <div className="request-general-info">
                <div className="info-row">
                    <span className="info-label">Status:</span>
                    <div className="info-value">{highlight(`${entry.response.status} ${entry.response.statusText}`, 'response', 'status')}</div>
                </div>
                <div className="info-row">
                    <span className="info-label">HTTP Version:</span>
                    <div className="info-value">{highlight(entry.response.httpVersion, 'response', 'http-version')}</div>
                </div>
                {entry.response.redirectURL && (
                    <div className="info-row">
                        <span className="info-label">Redirect URL:</span>
                        <div className="info-value url-value">{highlight(entry.response.redirectURL, 'response', 'redirect-url')}</div>
                    </div>
                )}
                <div className="info-row">
                    <span className="info-label">Content Type:</span>
                    <div className="info-value">{highlight(entry.response.content?.mimeType ?? '', 'response', 'content-type')}</div>
                </div>
                <div className="info-row">
                    <span className="info-label">Size:</span>
                    <div className="info-value">{highlight(formatBytes(entry.response.content?.size ?? 0), 'response', 'size')}</div>
                </div>
                {entry.response.content?.compression && (
                    <div className="info-row">
                        <span className="info-label">Compression:</span>
                        <div className="info-value">{highlight(`${formatBytes(entry.response.content.compression)} saved`, 'response', 'compression')}</div>
                    </div>
                )}
            </div>

            {responsePreviewText && (
                <>
                    <h4>Content Preview</h4>
                    <pre className="content-preview">
                        {highlight(responsePreviewText, 'response', 'content-preview')}
                    </pre>
                </>
            )}
        </div>
    );


    const renderRequestHeaders = () => (
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
                            <td className="header-name">{highlight(header.name, 'request headers', `request-header-${index}-name`)}</td>
                            <td className="header-value">{highlight(header.value, 'request headers', `request-header-${index}-value`)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>


        </div>
    );

    const renderResponseHeaders = () => (

        <div className="details-section">
            <div className="section-header">
                <h4>Response Headers</h4>
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
                    {entry.response.headers.map((header, index) => (
                        <tr key={index}>
                            <td className="header-name">{highlight(header.name, 'response headers', `response-header-${index}-name`)}</td>
                            <td className="header-value">{highlight(header.value, 'response headers', `response-header-${index}-value`)}</td>
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
                                    <td>{highlight(cookie.name, 'cookies', `request-cookie-${index}-name`)}</td>
                                    <td>{highlight(cookie.value, 'cookies', `request-cookie-${index}-value`)}</td>
                                    <td>{highlight(cookie.domain || 'N/A', 'cookies', `request-cookie-${index}-domain`)}</td>
                                    <td>{highlight(cookie.path || 'N/A', 'cookies', `request-cookie-${index}-path`)}</td>
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
                                    <td>{highlight(cookie.name, 'cookies', `response-cookie-${index}-name`)}</td>
                                    <td>{highlight(cookie.value, 'cookies', `response-cookie-${index}-value`)}</td>
                                    <td>{highlight(cookie.domain || 'N/A', 'cookies', `response-cookie-${index}-domain`)}</td>
                                    <td>{highlight(cookie.path || 'N/A', 'cookies', `response-cookie-${index}-path`)}</td>
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
                            <span className="timing-label">
                                {highlight(phase.charAt(0).toUpperCase() + phase.slice(1), 'timing', `timing-${phase}-name`)}
                            </span>
                            <span className="timing-value">{highlight(formatTime(time), 'timing', `timing-${phase}-value`)}</span>
                            <div className="timing-bar-container">
                                <div
                                    className={`timing-bar-fill timing-${phase}`}
                                    style={{ width: `${(time / totalTime) * 100}%` }}
                                />
                            </div>
                        </div>
                    ))}
                    <div className="timing-row timing-total-row">
                        <span className="timing-label">Total</span>
                        <span className="timing-value">{highlight(formatTime(totalTime), 'timing', 'timing-total')}</span>
                        <div className="timing-bar-container" aria-hidden="true" />
                    </div>
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

            {focusPath && (
                <div className={`request-focus-summary tone-${focusPath.confidence}`}>
                    <div className="request-focus-summary-head">
                        <span className="request-focus-pill">{focusLabel}</span>
                        <span className="request-focus-summary-copy">{focusPath.summary}</span>
                    </div>
                    {focusPath.reasonLabels.length > 0 && (
                        <div className="request-focus-chip-list" aria-label="Focus evidence">
                            {focusPath.reasonLabels.map((label) => (
                                <span key={label} className="request-focus-chip">{label}</span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="details-tabs">
                {DETAIL_TABS.map((tab) => {
                    const matchCount = matchCountByTab.get(tab.id) ?? 0;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => changeDetailsTab(tab.id)}
                        >
                            <span>{tab.label}</span>
                            {matchCount > 0 && (
                                <span className="details-tab-match-count" aria-label={`${matchCount} search matches`}>
                                    {matchCount}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {searchTerm.trim() && (
                <div className={`details-search-navigator ${searchOccurrences.length === 0 ? 'is-empty' : ''}`}>
                    <div className="details-search-summary" title={searchTerm.trim()}>
                        <span className="details-search-summary-label">Search matches</span>
                        {searchOccurrences.length > 0 ? (
                            <strong>{currentMatchIndex + 1} of {searchOccurrences.length}</strong>
                        ) : (
                            <strong>No visible match</strong>
                        )}
                        <span className="details-search-summary-context">
                            {searchOccurrences.length > 0
                                ? `${matchingSectionCount} section${matchingSectionCount === 1 ? '' : 's'}`
                                : 'The match is in HAR metadata not displayed here'}
                        </span>
                    </div>
                    {searchOccurrences.length > 1 && (
                        <div className="details-search-controls" aria-label="Search result navigation">
                            <button type="button" onClick={() => navigateToMatch(-1)} aria-label="Previous search match" title="Previous match">
                                <span aria-hidden="true">&#8249;</span>
                            </button>
                            <button type="button" onClick={() => navigateToMatch(1)} aria-label="Next search match" title="Next match">
                                <span aria-hidden="true">&#8250;</span>
                            </button>
                        </div>
                    )}
                </div>
            )}

            <div className="details-content" ref={detailsContentRef}>
                {activeTab === 'request' && renderRequest()}
                {activeTab === 'response' && renderResponse()}
                {activeTab === 'request headers' && renderRequestHeaders()}
                {activeTab === 'response headers' && renderResponseHeaders()}
                {activeTab === 'cookies' && renderCookies()}
                {activeTab === 'timing' && renderTiming()}
            </div>
        </div>
    );
};

export default RequestDetails;
