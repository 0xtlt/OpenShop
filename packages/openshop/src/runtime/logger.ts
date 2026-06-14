export interface RuntimeLogger {
  info: (message: string, context?: Record<string, unknown>) => void
  warn: (message: string, context?: Record<string, unknown>) => void
  error: (message: string, context?: Record<string, unknown>) => void
}

const defaultLogger: RuntimeLogger = {
  info(message, context) {
    if (context) console.log(message, context)
    else console.log(message)
  },
  warn(message, context) {
    if (context) console.warn(message, context)
    else console.warn(message)
  },
  error(message, context) {
    if (context) console.error(message, context)
    else console.error(message)
  },
}

let logger: RuntimeLogger = defaultLogger

export function setRuntimeLogger(nextLogger: RuntimeLogger): RuntimeLogger {
  const previousLogger = logger
  logger = nextLogger
  return previousLogger
}

export function getRuntimeLogger(): RuntimeLogger {
  return logger
}
