import winston from 'winston';
import { getLogContext } from "./logContext.js";

// log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const level = () => {
  const env = process.env.NODE_ENV || 'development';
  return env === 'development' ? 'debug' : 'warn';
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

const injectContext = winston.format((info) => {
  const ctx = getLogContext();
  if (ctx?.requestId) (info as any).requestId = ctx.requestId;
  if (ctx?.job) (info as any).job = ctx.job;
  return info;
});

const isDev = (process.env["NODE_ENV"] ?? "development") === "development";

const format = isDev
  ? winston.format.combine(
      injectContext(),
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss:ms" }),
      winston.format.colorize({ all: true }),
      winston.format.printf((info) => {
        const rid = (info as any).requestId ? ` rid=${(info as any).requestId}` : "";
        const job = (info as any).job
          ? ` job=${(info as any).job.queue}:${(info as any).job.jobId}`
          : "";
        const meta = `${rid}${job}`;
        return `${info.timestamp} ${info.level}: ${info.message}${meta}`;
      }),
    )
  : winston.format.combine(
      injectContext(),
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    );

const transports = [
  new winston.transports.Console(),
];

const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
});

export default logger;