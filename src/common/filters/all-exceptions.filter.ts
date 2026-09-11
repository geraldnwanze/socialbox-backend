import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { AppException } from '../exceptions/app.exception';

interface ErrorResponseBody {
  status: 'error';
  statusCode: number;
  message: string;
  code: string;
  requestId?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request.headers['x-request-id'] as string) ?? undefined;

    const { statusCode, message, code } = this.resolve(exception);

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${statusCode} ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
      Sentry.captureException(exception);
    } else {
      this.logger.warn(
        `${request.method} ${request.url} -> ${statusCode} ${message}`,
      );
    }

    const body: ErrorResponseBody = {
      status: 'error',
      statusCode,
      message,
      code,
      requestId,
    };

    response.status(statusCode).json(body);
  }

  private resolve(exception: unknown): {
    statusCode: number;
    message: string;
    code: string;
  } {
    if (exception instanceof AppException) {
      return {
        statusCode: exception.getStatus(),
        message: exception.message,
        code: exception.code,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] })?.message ??
            exception.message);
      return {
        statusCode: status,
        message: Array.isArray(message) ? message.join(', ') : message,
        code: HttpStatus[status] ?? 'ERROR',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred',
      code: 'INTERNAL_SERVER_ERROR',
    };
  }
}
