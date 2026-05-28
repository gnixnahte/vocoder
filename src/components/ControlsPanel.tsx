type ControlsPanelProps = {
  apiUrl: string
  setApiUrl: (value: string) => void
  fps: number
  setFps: (value: number) => void
  selectedAudioInputId: string
  setSelectedAudioInputId: (value: string) => void
  audioInputs: MediaDeviceInfo[]
  cameraOn: boolean
  startCamera: () => void
  stopCamera: () => void
  micOn: boolean
  toggleMic: () => void
  status: string
  handsCount: number
  handHeight: number
  monitorLevel: number
  reverbMix: number
  leftHandHeight: number
  singleHandPinchMix: number
  isOpenPalmForward: boolean
  isFistForward: boolean
  isFistSide: boolean
  isFistSideLeft: boolean
  isFistSideRight: boolean
  leftHandFistForward: boolean
  singleHandFistForward: boolean
  leftHandRotation: number
  singleHandRotation: number
  leftHandForwardTilt: number
  singleHandForwardTilt: number
}

export function ControlsPanel({
  apiUrl,
  setApiUrl,
  fps,
  setFps,
  selectedAudioInputId,
  setSelectedAudioInputId,
  audioInputs,
  cameraOn,
  startCamera,
  stopCamera,
  micOn,
  toggleMic,
  status,
  handsCount,
  handHeight,
  monitorLevel,
  reverbMix,
  leftHandHeight,
  singleHandPinchMix,
  isOpenPalmForward,
  isFistForward,
  isFistSide,
  isFistSideLeft,
  isFistSideRight,
  leftHandFistForward,
  singleHandFistForward,
  leftHandRotation,
  singleHandRotation,
  leftHandForwardTilt,
  singleHandForwardTilt,
}: ControlsPanelProps) {
  const metrics = [
    `Status: ${status}`,
    `Hands detected: ${handsCount}`,
    `Active hand height: ${handHeight.toFixed(2)}`,
    `Left hand height: ${leftHandHeight.toFixed(2)}`,
    `Single hand pinch mix: ${singleHandPinchMix.toFixed(2)}`,
    `Monitor level: ${monitorLevel.toFixed(2)}`,
    `Reverb mix: ${reverbMix.toFixed(2)}`,
    `Open palm forward: ${isOpenPalmForward ? 'yes' : 'no'}`,
    `Fist forward: ${isFistForward ? 'yes' : 'no'}`,
    `Fist side: ${isFistSide ? 'yes' : 'no'}`,
    `Fist side left: ${isFistSideLeft ? 'yes' : 'no'}`,
    `Fist side right: ${isFistSideRight ? 'yes' : 'no'}`,
    `Left fist forward: ${leftHandFistForward ? 'yes' : 'no'}`,
    `Single fist forward: ${singleHandFistForward ? 'yes' : 'no'}`,
    `Left hand rotation: ${leftHandRotation.toFixed(2)}`,
    `Single hand rotation: ${singleHandRotation.toFixed(2)}`,
    `Left hand forward tilt: ${leftHandForwardTilt.toFixed(2)}`,
    `Single hand forward tilt: ${singleHandForwardTilt.toFixed(2)}`,
  ]

  return (
    <section style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
      <label>
        Backend URL
        <input
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          style={{ width: '100%', padding: '8px', marginTop: '6px' }}
        />
      </label>

      <label>
        FPS ({fps})
        <input
          type="range"
          min={1}
          max={30}
          value={fps}
          onChange={(e) => setFps(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </label>

      <label>
        Mic Input Device
        <select
          value={selectedAudioInputId}
          onChange={(e) => setSelectedAudioInputId(e.target.value)}
          style={{ width: '100%', padding: '8px', marginTop: '6px' }}
        >
          {audioInputs.length ? (
            audioInputs.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${index + 1}`}
              </option>
            ))
          ) : (
            <option value="">No microphones found</option>
          )}
        </select>
      </label>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button type="button" onClick={startCamera} disabled={cameraOn}>
          Start Camera
        </button>
        <button type="button" onClick={stopCamera} disabled={!cameraOn}>
          Stop Camera
        </button>
        <button type="button" onClick={toggleMic}>
          {micOn ? 'Mic Off' : 'Mic On'}
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: '6px 16px',
        }}
      >
        {metrics.map((metric) => (
          <small key={metric}>{metric}</small>
        ))}
      </div>
    </section>
  )
}
