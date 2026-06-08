type GestureHudProps = {
  handsCount: number
  monitorLevel: number
  reverbMix: number
  isOpenPalmForward: boolean
  isFistForward: boolean
  isFistSide: boolean
  isFistSideLeft: boolean
  isFistSideRight: boolean
  leftHandFistForward: boolean
  rightHandClosedFist: boolean
  singleHandPinkyUpClosed: boolean
  singleHandFistForward: boolean
  leftHandRotation: number
  singleHandRotation: number
  leftHandForwardTilt: number
  singleHandForwardTilt: number
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

const formatPercent = (value: number) => `${Math.round(clamp01(value) * 100)}%`

function HudMeter({
  label,
  value,
  active = value > 0.02,
}: {
  label: string
  value: number
  active?: boolean
}) {
  const clampedValue = clamp01(value)

  return (
    <div className={`gesture-hud__meter${active ? ' is-active' : ''}`}>
      <div className="gesture-hud__meter-label">
        <span>{label}</span>
        <strong>{formatPercent(clampedValue)}</strong>
      </div>
      <div className="gesture-hud__track" aria-hidden="true">
        <div className="gesture-hud__fill" style={{ width: formatPercent(clampedValue) }} />
      </div>
    </div>
  )
}

function GesturePill({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={`gesture-hud__pill${active ? ' is-active' : ''}`}>
      <span className="gesture-hud__dot" aria-hidden="true" />
      {label}
    </span>
  )
}

export function GestureHud({
  handsCount,
  monitorLevel,
  reverbMix,
  isOpenPalmForward,
  isFistForward,
  isFistSide,
  isFistSideLeft,
  isFistSideRight,
  leftHandFistForward,
  rightHandClosedFist,
  singleHandPinkyUpClosed,
  singleHandFistForward,
  leftHandRotation,
  singleHandRotation,
  leftHandForwardTilt,
  singleHandForwardTilt,
}: GestureHudProps) {
  const oneHandMode = handsCount === 1
  const tremoloSourceActive = oneHandMode ? singleHandFistForward : leftHandFistForward
  const tremoloDepth = tremoloSourceActive
    ? oneHandMode
      ? singleHandRotation
      : leftHandRotation
    : 0
  const tremoloRate = tremoloSourceActive
    ? oneHandMode
      ? singleHandForwardTilt
      : leftHandForwardTilt
    : 0
  const vocoderActive = oneHandMode ? singleHandPinkyUpClosed : rightHandClosedFist
  const gestureLabel = isOpenPalmForward
    ? 'Open Palm'
    : isFistForward
      ? 'Fist Forward'
      : isFistSide
        ? isFistSideLeft
          ? 'Fist Side Left'
          : isFistSideRight
            ? 'Fist Side Right'
            : 'Fist Side'
        : 'None'

  return (
    <aside className="gesture-hud" aria-label="Gesture HUD">
      <div className="gesture-hud__header">
        <span>Gesture HUD</span>
        <strong>{handsCount} hand{handsCount === 1 ? '' : 's'}</strong>
      </div>

      <div className="gesture-hud__status">
        <span className="gesture-hud__current">{gestureLabel}</span>
        <span className={`gesture-hud__mode${oneHandMode ? ' is-one-hand' : ''}`}>
          {oneHandMode ? 'Solo' : 'Dual'}
        </span>
      </div>

      <div className="gesture-hud__grid">
        <HudMeter label="Volume" value={monitorLevel / 2} active={monitorLevel > 0.02} />
        <HudMeter label="Reverb" value={reverbMix} />
        <HudMeter label="Tremolo" value={tremoloDepth} active={tremoloSourceActive} />
        <HudMeter label="Rate" value={tremoloRate} active={tremoloSourceActive} />
      </div>

      <div className="gesture-hud__pills">
        <GesturePill label="Palm" active={isOpenPalmForward} />
        <GesturePill label="Fist" active={isFistForward || leftHandFistForward || singleHandFistForward} />
        <GesturePill label="Side" active={isFistSide} />
        <GesturePill label="Vocoder" active={vocoderActive} />
      </div>
    </aside>
  )
}
