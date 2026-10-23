/* eslint-disable @next/next/no-img-element */
import { cx } from './ui';

/** The shop's own logo (also used as the favicon). */
export function Logo({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo.png"
      alt="Aiv's Cafe"
      width={size}
      height={size}
      className={cx('shrink-0 rounded-full ring-1 ring-line', className)}
      style={{ width: size, height: size }}
    />
  );
}
