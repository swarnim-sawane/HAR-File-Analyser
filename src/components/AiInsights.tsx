import React, { useEffect, useState } from 'react';
import { HarFile } from '../types/har';
import { useInsights } from '../hooks/useInsights';
import AiInsightsSurface from './AiInsightsSurface';

interface Props {
  harData: HarFile;
  backendUrl: string;
  onGeneratingChange?: (isGenerating: boolean) => void;
}

const AiInsights: React.FC<Props> = ({
  harData,
  backendUrl,
  onGeneratingChange,
}) => {
  const { insights, isGenerating, error, generate, cancel } = useInsights(
    harData,
    backendUrl
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    onGeneratingChange?.(isGenerating);
  }, [isGenerating, onGeneratingChange]);

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
      variant="har"
      loadingMessage="OCA is analyzing your HAR file"
      loadingHint="This usually takes 15-30 seconds."
      emptyDescription="Oracle-aware diagnostics for the current HAR session, organized into a calmer summary-first review."
      productsLabel="Oracle products"
    />
  );
};

export default AiInsights;
