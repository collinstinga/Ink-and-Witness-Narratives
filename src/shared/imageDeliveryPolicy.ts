/** A finite set keeps responsive-image transforms and CDN cache keys bounded. */
export const IMAGE_DELIVERY_WIDTHS = [64, 128, 320, 480, 640, 960, 1280, 1600, 1920] as const;
export type ImageDeliveryWidth = typeof IMAGE_DELIVERY_WIDTHS[number];

export function isImageDeliveryWidth(value: number): value is ImageDeliveryWidth {
  return (IMAGE_DELIVERY_WIDTHS as readonly number[]).includes(value);
}
