import { resolveConsoleDisplayLevel } from '../../shared/consoleLogCore';
import type { ConsoleLogEntry, LogLevel } from '../types/consolelog';

export function getConsoleDisplayLevel(
  entry: Pick<ConsoleLogEntry, 'level' | 'inferredSeverity'>,
): LogLevel {
  return resolveConsoleDisplayLevel(entry.level, entry.inferredSeverity) as LogLevel;
}
