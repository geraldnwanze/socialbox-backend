import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base exception carrying a stable machine-readable `code` alongside the HTTP status,
 * so the API's error shape never leaks raw third-party/provider error details.
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(message, status);
  }
}

export class ResourceNotFoundException extends AppException {
  constructor(resource: string) {
    super('RESOURCE_NOT_FOUND', `${resource} not found`, HttpStatus.NOT_FOUND);
  }
}

export class WorkspaceAccessDeniedException extends AppException {
  constructor() {
    super(
      'WORKSPACE_ACCESS_DENIED',
      'You do not have access to this workspace',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class InsufficientRoleException extends AppException {
  constructor() {
    super(
      'INSUFFICIENT_ROLE',
      'You do not have permission to perform this action',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class MessageSendFailedException extends AppException {
  constructor(message = 'Unable to send message') {
    super('MESSAGE_SEND_FAILED', message, HttpStatus.BAD_GATEWAY);
  }
}

export class ChannelNotSupportedException extends AppException {
  constructor(channelType: string) {
    super(
      'CHANNEL_NOT_SUPPORTED',
      `Channel type "${channelType}" is not available in this MVP`,
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
