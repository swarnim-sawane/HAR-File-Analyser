import React, { useMemo, useState } from 'react';
import { ConsoleLogFile } from '../types/consolelog';
import { useConsoleLogInsights } from '../hooks/useConsoleLogInsights';
import { getConsoleDisplayLevel } from '../utils/consoleLogSeverity';
import AiInsightsSurface, { type AiObservedSignals } from './AiInsightsSurface';

interface Props {
  logData: ConsoleLogFile;
  backendUrl: string;
}

function normalizeSignalMessage(message: string) {
  return message.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function buildObservedSignals(logData: ConsoleLogFile): AiObservedSignals | undefined {
  let errorCount = 0;
  let warningCount = 0;
  const issueTagCounts = new Map<string, number>();
  const repeatedErrors = new Map<
    string,
    { count: number; source?: string; message: string }
  >();

  logData.entries.forEach((entry) => {
    const displayLevel = getConsoleDisplayLevel(entry);

    if (displayLevel === 'error') {
      errorCount += 1;
      const message = normalizeSignalMessage(entry.message || entry.rawText || 'Unknown error');
      const source = entry.source || 'Unknown source';
      const key = `${source}::${message}`;
      const current = repeatedErrors.get(key);
      repeatedErrors.set(key, {
        count: (current?.count ?? 0) + 1,
        source,
        message,
      });
    } else if (displayLevel === 'warn') {
      warningCount += 1;
    }

    entry.issueTags.forEach((tag) => {
      issueTagCounts.set(tag, (issueTagCounts.get(tag) ?? 0) + 1);
    });
  });

  const topIssueTags = Array.from(issueTagCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([tag, count]) => ({ tag, count }));

  const topRepeatedSignal = Array.from(repeatedErrors.values())
    .sort((a, b) => b.count - a.count)[0];

  if (errorCount === 0 && warningCount === 0 && topIssueTags.length === 0) {
    return undefined;
  }

  return {
    errorCount,
    warningCount,
    topIssueTags,
    ...(topRepeatedSignal ? { topRepeatedSignal } : {}),
  };
}

const ConsoleLogAiInsights: React.FC<Props> = ({
  logData,
  backendUrl,
}) => {
  const { insights, isGenerating, error, generate, cancel } =
    useConsoleLogInsights(logData, backendUrl);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const observedSignals = useMemo(() => buildObservedSignals(logData), [logData]);

  const toggleCard = (key: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <AiInsightsSurface
      insights={insights}
      isGenerating={isGenerating}
      error={error}
      generate={generate}
      cancel={cancel}
      expanded={expanded}
      onToggleCard={toggleCard}
      variant="console"
      loadingMessage="OCA is analyzing your console log"
      loadingHint="This usually takes 15-30 seconds."
      emptyDescription="Intelligent diagnostics for console errors, warnings, recurring patterns, and suggested next steps in a calmer summary-first review."
      productsLabel="Detected products"
      observedSignals={observedSignals}
    />
  );
};

export default ConsoleLogAiInsights;
