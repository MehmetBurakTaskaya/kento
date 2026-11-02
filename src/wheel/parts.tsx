// SPDX-License-Identifier: MIT
// The steel parts of the wheel, drawn in the 400-unit space. Each part that moves is its own element
// so the browser rasterizes it once per theme and scale and only moves the layer (design/DESIGN.md,
// section 9): the dial turns, the handle turns an eighth, the bolts slide out. Nothing here uses an SVG
// filter; the brushing and the knurl are gradients and dash patterns.
import { memo, type CSSProperties } from 'react';
import {
  arcPath,
  BOLT,
  BOLT_ANGLES,
  C,
  fx,
  polar,
  R,
  rayPath,
  ringPath,
  sectorPath,
  SPOKE_ANGLES,
  VIEW,
} from './geometry';

const VIEWBOX = `0 0 ${VIEW} ${VIEW}`;
const stop = (offset: number, token: string) => <stop offset={offset} style={{ stopColor: `var(--${token})` }} />;

/** One bolt, in its own 25 x 25 box at the top of the wheel, turned onto its boundary. Its shadow is a
 * box-shadow turned back against the bolt's angle, so every bolt casts it downwards. */
function Bolt({ angle, uid }: { angle: number; uid: string }) {
  const { width: w, length: h } = BOLT;
  const a = (angle * Math.PI) / 180;
  const dx = 1.5 * Math.sin(a);
  const dy = 1.5 * Math.cos(a);
  const unit = (n: number) => `calc(var(--wheel-size) * ${fx(n / VIEW)})`;
  return (
    <div className="wheel-layer wheel-bolt-arm" style={{ transform: `rotate(${angle}deg)` }}>
      <div className="wheel-bolt" style={{ boxShadow: `${unit(dx)} ${unit(dy)} ${unit(1.2)} var(--bolt-shadow)` }}>
        <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
          <rect width={w} height={h} rx={2} fill={`url(#${uid}-bolt)`} className="wheel-bolt-body" />
          <rect
            x={0.6}
            y={0.6}
            width={w - 1.2}
            height={3.8}
            rx={1.4}
            fill={`url(#${uid}-cap)`}
            className="wheel-bolt-cap"
          />
          <path d={`M0.6 4.6H${w - 0.6}`} className="wheel-bolt-chamfer" />
          <path d={`M7.2 6.2V${h - 2}`} className="wheel-bolt-spec" />
          <rect width={w} height={h} rx={2} className="wheel-bolt-edge" />
        </svg>
      </div>
    </div>
  );
}

export const Bolts = memo(function Bolts({ uid }: { uid: string }) {
  return (
    <div className="wheel-layer wheel-bolts">
      <svg className="wheel-defs" aria-hidden="true">
        <defs>
          <linearGradient id={`${uid}-bolt`} x1="0" y1="0" x2="1" y2="0">
            {stop(0, 'bolt-lo')}
            {stop(0.3, 'bolt-hi')}
            {stop(0.55, 'bolt-mid')}
            {stop(0.86, 'bolt-lo')}
            {stop(1, 'bolt-edge')}
          </linearGradient>
          <linearGradient id={`${uid}-cap`} x1="0" y1="0" x2="1" y2="0">
            {stop(0, 'cap-lo')}
            {stop(0.35, 'cap-hi')}
            {stop(1, 'cap-lo')}
          </linearGradient>
        </defs>
      </svg>
      {BOLT_ANGLES.map((angle) => (
        <Bolt key={angle} angle={angle} uid={uid} />
      ))}
    </div>
  );
});

/** The turning combination dial: knurled grip, a 100-step scale numbered every ten. */
export const DialScale = memo(function DialScale({ numbers }: { numbers: string[] }) {
  let fine = '';
  let major = '';
  for (let k = 1; k < 100; k++) {
    const a = k * 3.6;
    if (k % 10 === 0) major += rayPath(R.SCALE, 174.4, a);
    else if (k % 5 === 0) major += rayPath(R.SCALE, 176.2, a);
    else fine += rayPath(R.SCALE, 177.6, a);
  }
  const ridge = (2 * Math.PI * R.KNURL) / 168;
  return (
    <svg className="wheel-layer wheel-scale" viewBox={VIEWBOX} aria-hidden="true">
      <circle cx={C} cy={C} r={R.FACE + 0.5} className="wheel-edge-in" />
      <path d={fine} className="wheel-dial-fine" />
      <path d={major} className="wheel-dial-major" />
      {numbers.map((text, i) => {
        const a = (i + 1) * 36;
        const [x, y] = polar(R.DIAL_NUMBER, a);
        return (
          <text
            key={a}
            x={fx(x)}
            y={fx(y)}
            className="wheel-dial-number"
            transform={`rotate(${fx(a)} ${fx(x)} ${fx(y)})`}
          >
            {text}
          </text>
        );
      })}
      <circle cx={C} cy={C} r={R.SCALE + 0.4} className="wheel-groove" />
      <circle
        cx={C}
        cy={C}
        r={R.KNURL}
        className="wheel-knurl"
        strokeDasharray={`${fx(ridge * 0.44)} ${fx(ridge * 0.56)}`}
      />
      <circle
        cx={C}
        cy={C}
        r={R.KNURL}
        className="wheel-knurl-hi"
        strokeDasharray={`${fx(ridge * 0.16)} ${fx(ridge * 0.84)}`}
        strokeDashoffset={fx(-ridge * 0.48)}
      />
    </svg>
  );
});

/** The blued index on the dial; the latch drops it onto the numeral on apply. */
export const DialIndex = memo(function DialIndex() {
  return (
    <svg className="wheel-layer wheel-index" viewBox={VIEWBOX} aria-hidden="true">
      <path
        d={`M${C - 4.7} ${C - 186.5}H${C + 4.7}V${C - 170.5}L${C} ${C - 161.8}L${C - 4.7} ${C - 170.5}Z`}
        className="wheel-pointer"
      />
      <path
        d={`M${C - 3.2} ${C - 185}H${C - 0.5}V${C - 164.2}L${C - 3.2} ${C - 170.2}Z`}
        className="wheel-pointer-hi"
      />
    </svg>
  );
});

/** The fixed polished ring with the index notch at twelve o'clock and a channel for each bolt. */
export const FixedRing = memo(function FixedRing({ uid }: { uid: string }) {
  return (
    <svg className="wheel-layer wheel-ring" viewBox={VIEWBOX} aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}-ring`} gradientUnits="userSpaceOnUse" x1="60" y1="30" x2="340" y2="370">
          {stop(0, 'ring-hi')}
          {stop(0.45, 'ring-mid')}
          {stop(1, 'ring-lo')}
        </linearGradient>
      </defs>
      <path d={ringPath(R.RING, R.OUT)} fill={`url(#${uid}-ring)`} fillRule="evenodd" className="wheel-ring-steel" />
      <circle cx={C} cy={C} r={R.RING + 1.3} className="wheel-ring-hi" />
      <circle cx={C} cy={C} r={R.RING + 0.4} className="wheel-ring-step" />
      <circle cx={C} cy={C} r={R.OUT - 0.5} className="wheel-edge-out" />
      <path d={`M${C - 4.6} ${C - 195.2}H${C + 4.6}L${C} ${C - 187.4}Z`} className="wheel-notch" />
      {BOLT_ANGLES.map((a) => (
        <g key={a} transform={`rotate(${a} ${C} ${C})`}>
          <rect
            x={C - BOLT.width / 2 - 1}
            y={C - R.OUT - 0.2}
            width={BOLT.width + 2}
            height={4.6}
            rx={1.2}
            className="wheel-channel"
          />
          <path
            d={`M${C - BOLT.width / 2 - 0.6} ${C - R.OUT + 4.6}H${C + BOLT.width / 2 + 0.6}`}
            className="wheel-lip"
          />
        </g>
      ))}
    </svg>
  );
});

/** A glint that runs once round the steel when the bolts are home. */
export const Glint = memo(function Glint() {
  return (
    <svg className="wheel-layer wheel-glint" viewBox={VIEWBOX} aria-hidden="true">
      {(
        [
          [24, 0.16],
          [12, 0.3],
          [4.5, 0.62],
        ] as const
      ).map(([w, o]) => (
        <path key={w} d={sectorPath(R.FACE + 0.6, R.OUT - 0.6, -w, w)} fill="#fff" fillOpacity={o} />
      ))}
    </svg>
  );
});

/** The four-spoke vault handle round the hub cap; it turns an eighth on apply. */
export const Handle = memo(function Handle({ uid }: { uid: string }) {
  const spokes = SPOKE_ANGLES.map((a) => rayPath(R.HUB, R.KNOB, a)).join('');
  return (
    <svg className="wheel-layer wheel-handle" viewBox={VIEWBOX} aria-hidden="true">
      <defs>
        <radialGradient id={`${uid}-knob`} cx="0.36" cy="0.32" r="0.75">
          {stop(0, 'knob-hi')}
          {stop(1, 'knob-lo')}
        </radialGradient>
      </defs>
      <path d={spokes} className="wheel-spoke-edge" />
      <path d={spokes} className="wheel-spoke" />
      <path d={spokes} className="wheel-spoke-hi" />
      {SPOKE_ANGLES.map((a) => {
        const [x, y] = polar(R.KNOB, a);
        return <circle key={a} cx={fx(x)} cy={fx(y)} r={6.2} fill={`url(#${uid}-knob)`} className="wheel-knob" />;
      })}
    </svg>
  );
});

/** Half of the keyline of the slice that opens or closes a ring, run round the chapter ring: the two
 *  halves part from the slice and meet on the far side, or come back and meet on it. */
export const Arm = memo(function Arm({ from, to, entrance }: { from: number; to: number; entrance: 'in' | 'out' }) {
  return (
    <svg
      className={`wheel-layer wheel-arm is-${entrance}`}
      viewBox={VIEWBOX}
      aria-hidden="true"
      style={{ '--arm-from': `${fx(from)}deg`, '--arm-to': `${fx(to)}deg` } as CSSProperties}
    >
      <path d={arcPath(R.CHAPTER - 1.7, -10, 10)} />
    </svg>
  );
});

export interface HubLine {
  text: string;
  size: number;
}

/** Where the hub's lines sit. Inside a ring they rise to leave room for the Back control, and the
 *  trail of the rings above heads the title, so the two read as one breadcrumb. */
export function hubLayout(subtitle: boolean, raised: boolean) {
  const titleY = subtitle ? (raised ? C - 16.5 : C - 8) : raised ? C - 9 : C;
  return { trailY: titleY - 14.5, titleY, subtitleY: raised ? C + 1.5 : C + 8.5 };
}

/** The hub cap in its steel collar, with the wheel's title and the file name; inside a ring, the
 *  ring's own title under the trail that led to it. */
export const HubCap = memo(function HubCap({
  uid,
  title,
  subtitle,
  trail,
  raised,
  entrance,
  textKey,
}: {
  uid: string;
  title: HubLine;
  subtitle: HubLine | null;
  trail: HubLine | null;
  /** Leaves room under the text for the Back control. */
  raised: boolean;
  /** How the text came: with a ring opened or closed, it fades in as the title lands. */
  entrance: 'in' | 'out' | null;
  /** Changes with every ring opened or closed, so the text enters again. */
  textKey: number;
}) {
  const { trailY, titleY, subtitleY } = hubLayout(!!subtitle, raised);
  return (
    <svg className="wheel-layer wheel-hub" viewBox={VIEWBOX} aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}-collar`} gradientUnits="userSpaceOnUse" x1="150" y1="135" x2="250" y2="265">
          {stop(0, 'steel-hi')}
          {stop(0.45, 'steel-mid')}
          {stop(1, 'steel-lo')}
        </linearGradient>
        <radialGradient id={`${uid}-dome`} gradientUnits="userSpaceOnUse" cx="186" cy="172" r="72">
          <stop offset={0} stopColor="#fff" style={{ stopOpacity: 'var(--dome)' }} />
          <stop offset={1} stopColor="#fff" stopOpacity={0} />
        </radialGradient>
      </defs>
      <path d={ringPath(R.HUB, R.COLLAR)} fill={`url(#${uid}-collar)`} fillRule="evenodd" className="wheel-collar" />
      <circle cx={C} cy={C} r={R.COLLAR - 0.4} className="wheel-hub-edge" />
      <circle cx={C} cy={C} r={R.HUB} className="wheel-hub-face" />
      <circle cx={C} cy={C} r={R.HUB} fill={`url(#${uid}-dome)`} className="wheel-dome" />
      <circle cx={C} cy={C} r={R.HUB + 0.4} className="wheel-hub-edge" />
      <g key={textKey} className={entrance ? `wheel-hub-text is-${entrance}` : 'wheel-hub-text'}>
        {trail && (
          <text x={C} y={trailY} fontSize={trail.size} className="wheel-trail">
            {trail.text}
          </text>
        )}
        <text x={C} y={titleY} fontSize={title.size} className="wheel-title">
          {title.text}
        </text>
        {subtitle && (
          <text x={C} y={subtitleY} fontSize={subtitle.size} className="wheel-subtitle">
            {subtitle.text}
          </text>
        )}
      </g>
    </svg>
  );
});
