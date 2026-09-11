import { Inject, Injectable } from '@nestjs/common';
import { ChannelAdapter } from './interfaces/channel-adapter.interface';
import { ChannelType } from './enums/channel-type.enum';
import { CHANNEL_ADAPTER_LIST } from './channels.constants';
import { ChannelNotSupportedException } from '../common/exceptions/app.exception';

/**
 * Central lookup from ChannelType -> ChannelAdapter. This is the only place in the codebase
 * that is allowed to know the full list of concrete adapters; every other service asks the
 * registry for "the adapter for this connection" and works against the ChannelAdapter interface.
 */
@Injectable()
export class ChannelAdapterRegistry {
  private readonly adapters = new Map<ChannelType, ChannelAdapter>();

  constructor(@Inject(CHANNEL_ADAPTER_LIST) adapters: ChannelAdapter[]) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.type, adapter);
    }
  }

  getAvailableTypes(): ChannelType[] {
    return [...this.adapters.keys()];
  }

  has(type: ChannelType): boolean {
    return this.adapters.has(type);
  }

  get(type: ChannelType): ChannelAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new ChannelNotSupportedException(type);
    }
    return adapter;
  }

  find(type: ChannelType): ChannelAdapter | undefined {
    return this.adapters.get(type);
  }
}
