// The sites the off-box watch probes. All five are served from the same VPS, so all failing at once points at the
// server itself. A site is "up" only when its home page answers HTTP 200 within the probe timeout.
export interface Site {
  readonly name: string;
  readonly url: string;
}

export const SITES: readonly Site[] = [
  { name: 'noticesent.com', url: 'https://noticesent.com/' },
  { name: 'dreamvibehq.com', url: 'https://dreamvibehq.com/' },
  { name: 'meltpixels.com', url: 'https://meltpixels.com/' },
  { name: 'relayzero.ai', url: 'https://relayzero.ai/' },
  { name: 'facesentry.com', url: 'https://facesentry.com/' },
];
