export interface AppLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export const consoleLogger: AppLogger = {
  info(message, metadata) {
    console.log(message, metadata ?? {});
  },
  error(message, metadata) {
    console.error(message, metadata ?? {});
  },
};
