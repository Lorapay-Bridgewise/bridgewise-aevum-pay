import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Stroke icons from the redesign, drawn at 24 x 24. Decorative: screen readers read the label next to them. */
export type IconName =
  | 'home'
  | 'contacts'
  | 'shield'
  | 'shieldCheck'
  | 'scan'
  | 'send'
  | 'receive'
  | 'noSignal'
  | 'signal'
  | 'back'
  | 'close'
  | 'chevron'
  | 'check'
  | 'lock'
  | 'fingerprint'
  | 'plus'
  | 'search'
  | 'share'
  | 'torch'
  | 'pulse'
  | 'alert'
  | 'copy';

const paths: Record<IconName, React.ReactNode> = {
  home: (
    <>
      <Path d="M3 11l9-7 9 7" />
      <Path d="M5 10v10h14V10" />
    </>
  ),
  contacts: (
    <>
      <Circle cx="9" cy="8" r="4" />
      <Path d="M2 21c0-4 3-6 7-6s7 2 7 6" />
      <Path d="M17 11a3 3 0 1 0 0-6" />
      <Path d="M22 20c0-3-2-5-4-5.5" />
    </>
  ),
  shield: <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  shieldCheck: (
    <>
      <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <Path d="M9 12l2 2 4-4" />
    </>
  ),
  scan: (
    <>
      <Path d="M4 8V5a1 1 0 0 1 1-1h3" />
      <Path d="M16 4h3a1 1 0 0 1 1 1v3" />
      <Path d="M20 16v3a1 1 0 0 1-1 1h-3" />
      <Path d="M8 20H5a1 1 0 0 1-1-1v-3" />
      <Path d="M4 12h16" />
    </>
  ),
  send: (
    <>
      <Path d="M7 17L17 7" />
      <Path d="M8 7h9v9" />
    </>
  ),
  receive: (
    <>
      <Path d="M17 7L7 17" />
      <Path d="M16 17H7V8" />
    </>
  ),
  noSignal: (
    <>
      <Path d="M2 2l20 20" />
      <Path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <Path d="M5 12.9a10 10 0 0 1 5.2-2.8" />
      <Path d="M19 12.9a10 10 0 0 0-2.3-1.7" />
      <Circle cx="12" cy="20" r="0.6" />
    </>
  ),
  signal: (
    <>
      <Path d="M5 12.6a10 10 0 0 1 14 0" />
      <Path d="M8.5 16.1a5 5 0 0 1 7 0" />
      <Path d="M1.5 9a15 15 0 0 1 21 0" />
      <Circle cx="12" cy="19.5" r="0.6" />
    </>
  ),
  back: <Path d="M15 6l-6 6 6 6" />,
  close: (
    <>
      <Path d="M6 6l12 12" />
      <Path d="M18 6L6 18" />
    </>
  ),
  chevron: <Path d="M9 6l6 6-6 6" />,
  check: <Path d="M5 12l5 5 9-10" />,
  lock: (
    <>
      <Rect x="5" y="11" width="14" height="10" rx="2" />
      <Path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  fingerprint: (
    <>
      <Path d="M12 11v3a8 8 0 0 1-1.5 4.5" />
      <Path d="M8 8.5A5 5 0 0 1 17 11v2" />
      <Path d="M5.5 11a6.5 6.5 0 0 1 1-3.5" />
      <Path d="M9 12a3 3 0 0 1 6 0v1a11 11 0 0 1-1 4.5" />
      <Path d="M5.6 15a10 10 0 0 0 .4-3" />
      <Path d="M17 16.5a14 14 0 0 1-.7 2.5" />
    </>
  ),
  plus: (
    <>
      <Path d="M12 5v14" />
      <Path d="M5 12h14" />
    </>
  ),
  search: (
    <>
      <Circle cx="11" cy="11" r="7" />
      <Path d="M20 20l-4-4" />
    </>
  ),
  share: (
    <>
      <Path d="M12 3v12" />
      <Path d="M7 8l5-5 5 5" />
      <Path d="M5 14v6h14v-6" />
    </>
  ),
  torch: (
    <>
      <Path d="M7 3h10l-2 6v12H9V9z" />
      <Path d="M12 13v2" />
    </>
  ),
  pulse: <Path d="M3 12h4l3-7 4 14 3-7h4" />,
  alert: (
    <>
      <Circle cx="12" cy="12" r="10" />
      <Path d="M12 7v6" />
      <Circle cx="12" cy="17" r="0.8" />
    </>
  ),
  copy: (
    <>
      <Rect x="9" y="9" width="11" height="11" rx="2" />
      <Path d="M5 15V5a1 1 0 0 1 1-1h10" />
    </>
  ),
};

export function Icon({ name, size = 24, color = '#14201A', width = 2 }: { name: IconName; size?: number; color?: string; width?: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {paths[name]}
    </Svg>
  );
}
