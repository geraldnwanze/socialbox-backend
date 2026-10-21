import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { Request, Response } from 'express';
import { WidgetService } from './widget.service';
import { WIDGET_SCRIPT } from './widget-script';
import { VisitorInfoService } from './visitor-info';

class SendWidgetMessageDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/, { message: 'Invalid message id' })
  id: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text: string;

  /** The page the visitor is on — display only; sanitized server-side. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  pageUrl?: string;
}

const bearer = (header?: string) => header?.replace(/^Bearer\s+/i, '');

/**
 * Public endpoints called by the embedded widget from other people's websites — no user login,
 * so each one is authenticated by a visitor token (except config/session, gated by the widget
 * key + allowed origins) and rate limited per IP.
 */
@Controller()
export class WidgetController {
  constructor(
    private readonly widgetService: WidgetService,
    private readonly visitorInfo: VisitorInfoService,
  ) {}

  @Get('widget.js')
  script(@Res() res: Response) {
    res
      .type('application/javascript')
      // helmet defaults to same-origin, which would stop other sites loading this script.
      .set('Cross-Origin-Resource-Policy', 'cross-origin')
      .set('Cache-Control', 'public, max-age=300')
      .send(WIDGET_SCRIPT);
  }

  @Get('widget/:key/config')
  config(@Param('key') key: string, @Headers('origin') origin?: string) {
    return this.widgetService.getConfig(key, origin);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('widget/:key/sessions')
  @HttpCode(201)
  session(@Param('key') key: string, @Headers('origin') origin?: string) {
    return this.widgetService.createSession(key, origin);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('widget/messages')
  async messages(
    @Headers('authorization') authorization?: string,
    @Headers('origin') origin?: string,
  ) {
    const session = await this.widgetService.authenticate(
      bearer(authorization),
      origin,
    );
    return { messages: await this.widgetService.listMessages(session) };
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('widget/messages')
  @HttpCode(202)
  async send(
    @Body() dto: SendWidgetMessageDto,
    @Req() req: Request,
    @Headers('authorization') authorization?: string,
    @Headers('origin') origin?: string,
  ) {
    if (!dto?.text) throw new BadRequestException();
    const session = await this.widgetService.authenticate(
      bearer(authorization),
      origin,
    );
    return this.widgetService.sendMessage(
      session,
      dto,
      this.visitorInfo.fromRequest(req),
    );
  }
}
