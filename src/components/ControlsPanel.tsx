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
  setReverbMix: (value: number) => void
  leftHandHeight: number
  singleHandPinchMix: number
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
  setReverbMix,
  leftHandHeight,
  singleHandPinchMix,
}: ControlsPanelProps) {
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
        Reverb Mix ({reverbMix.toFixed(2)})
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={reverbMix}
          onChange={(e) => setReverbMix(Number(e.target.value))}
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

      <small>Status: {status}</small>
      <small>Hands detected: {handsCount}</small>
      <small>Hand height: {handHeight.toFixed(2)}</small>
      <small>Left hand height: {leftHandHeight.toFixed(2)}</small>
      <small>Single hand pinch mix: {singleHandPinchMix.toFixed(2)}</small>
      <small>Monitor level: {monitorLevel.toFixed(2)}</small>
      <small>Reverb mix: {reverbMix.toFixed(2)}</small>
    </section>
  )
}
