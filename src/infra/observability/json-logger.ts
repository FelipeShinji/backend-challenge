import { Injectable, LoggerService } from "@nestjs/common";
import { LoggerContext } from "./logger-context";

@Injectable()
export class JsonLoggerService implements LoggerService {
  log(message: any, ...optionalParams: any[]) {
    this.print("info", message, optionalParams);
  }

  error(message: any, ...optionalParams: any[]) {
    this.print("error", message, optionalParams);
  }

  warn(message: any, ...optionalParams: any[]) {
    this.print("warn", message, optionalParams);
  }

  debug(message: any, ...optionalParams: any[]) {
    this.print("debug", message, optionalParams);
  }

  verbose(message: any, ...optionalParams: any[]) {
    this.print("verbose", message, optionalParams);
  }

  private print(level: string, message: any, optionalParams: any[]) {
    const context = typeof optionalParams[optionalParams.length - 1] === "string" 
      ? optionalParams[optionalParams.length - 1] 
      : "Application";
      
    const store = LoggerContext.getStore() || {};

    // Remove complete financial payloads or sensitive details if logged as object
    let parsedMessage = message;
    if (typeof message === "object" && message !== null) {
      // Create a redacted copy of the object to prevent sensitive leak
      const copy = { ...message };
      if (copy.money) copy.money = "[REDACTED]";
      if (copy.balance) copy.balance = "[REDACTED]";
      parsedMessage = JSON.stringify(copy);
    }

    const logObject: Record<string, any> = {
      timestamp: new Date().toISOString(),
      level,
      context,
      message: parsedMessage,
      ...store,
    };

    if (level === "error") {
      const errorObj = optionalParams[0];
      if (errorObj instanceof Error) {
        logObject.error = errorObj.message;
        logObject.stack = errorObj.stack;
      } else if (errorObj && typeof errorObj === "object") {
        logObject.error = JSON.stringify(errorObj);
      } else if (typeof errorObj === "string") {
        logObject.error = errorObj;
      }
    }

    if (level === "error") {
      console.error(JSON.stringify(logObject));
    } else {
      console.log(JSON.stringify(logObject));
    }
  }
}
