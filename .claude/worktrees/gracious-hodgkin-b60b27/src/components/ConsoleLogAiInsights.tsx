import React, { useState } from 'react';
import { ConsoleLogFile } from '../types/consolelog';
import { useConsoleLogInsights } from '../hooks/useConsoleLogInsights';
import AiInsightsSurface from './AiInsightsSurface';

interface Props {
  logData: ConsoleLogFile;
  backendUrl: string;
}

const ConsoleLogAiInsights: React.FC<Props> = ({
  logData,
  backendUrl,
}) => {
  const { insights, isGenerating, error, generate, cancel } =
    useConsoleLogInsights(logData, backendUrl);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
      emptyDescription="Intelligent diagnostics for console errors, warnings, recurring patterns, and likely fixes in a calmer summary-first review."
      productsLabel="Detected products"
    />
  );
};

export default ConsoleLogAiInsights;
