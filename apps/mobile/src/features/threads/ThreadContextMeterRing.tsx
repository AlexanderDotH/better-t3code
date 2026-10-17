import Svg, { Circle, Text as SvgText } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedSvg = withUniwind(Svg);
const CONTEXT_RING_SIZE = 20;
const CONTEXT_RING_STROKE = 3;
const CONTEXT_RING_RADIUS = (CONTEXT_RING_SIZE - CONTEXT_RING_STROKE) / 2;
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS;

export function ThreadContextMeterRing(props: {
  readonly fill: number;
  readonly critical?: boolean;
  readonly unknown?: boolean;
}) {
  return (
    <ThemedSvg
      accessible={false}
      width={CONTEXT_RING_SIZE}
      height={CONTEXT_RING_SIZE}
      viewBox={`0 0 ${CONTEXT_RING_SIZE} ${CONTEXT_RING_SIZE}`}
      colorClassName={props.critical ? "accent-danger-foreground" : "accent-icon-muted"}
    >
      <Circle
        cx={CONTEXT_RING_SIZE / 2}
        cy={CONTEXT_RING_SIZE / 2}
        r={CONTEXT_RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeWidth={CONTEXT_RING_STROKE}
      />
      {props.fill > 0 ? (
        <Circle
          cx={CONTEXT_RING_SIZE / 2}
          cy={CONTEXT_RING_SIZE / 2}
          r={CONTEXT_RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={CONTEXT_RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={CONTEXT_RING_CIRCUMFERENCE}
          strokeDashoffset={CONTEXT_RING_CIRCUMFERENCE * (1 - props.fill)}
          rotation={-90}
          origin={`${CONTEXT_RING_SIZE / 2}, ${CONTEXT_RING_SIZE / 2}`}
        />
      ) : null}
      {props.unknown ? (
        <SvgText
          x={CONTEXT_RING_SIZE / 2}
          y={CONTEXT_RING_SIZE / 2}
          dy={3}
          fill="currentColor"
          textAnchor="middle"
          fontSize={11}
        >
          –
        </SvgText>
      ) : null}
    </ThemedSvg>
  );
}
