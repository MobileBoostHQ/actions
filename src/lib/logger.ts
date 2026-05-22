import * as core from '@actions/core';

// Thin wrapper over @actions/core so the rest of the code never imports core
// directly (keeps units testable and gives one place to tweak formatting).
export const logger = {
  info(message: string): void {
    core.info(message);
  },
  warning(message: string): void {
    core.warning(message);
  },
  error(message: string): void {
    core.error(message);
  },
  debug(message: string): void {
    core.debug(message);
  },
  startGroup(name: string): void {
    core.startGroup(name);
  },
  endGroup(): void {
    core.endGroup();
  },
};

export type Logger = typeof logger;
