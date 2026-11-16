export const ONLINE_CHANNELS = [
  { value: 'storefront', label: 'Own website' },
  { value: 'marketplace', label: 'Marketplace' },
  { value: 'social', label: 'Social or chat' },
  { value: 'other', label: 'Other online channel' },
] as const;

export type OnlineChannel = typeof ONLINE_CHANNELS[number]['value'];

export interface OnlineOrderReference {
  channel: OnlineChannel;
  reference: string;
}

export function validateOnlineReference(order: OnlineOrderReference): OnlineOrderReference {
  const reference = order.reference.trim();
  if (!ONLINE_CHANNELS.some(({ value }) => order.channel === value) || !reference || Array.from(reference).length > 100) {
    throw new Error('Choose a sales channel and enter an order reference of up to 100 characters.');
  }
  return { channel: order.channel, reference };
}

export function onlineChannelLabel(channel: OnlineChannel) {
  return ONLINE_CHANNELS.find(({ value }) => value === channel)?.label ?? channel;
}

export interface OrderDispatch {
  carrier: string;
  tracking: string;
  recordedAt: string;
}
