import { useEffect, useState } from 'react'
import './App.css'
import { ControlsPanel } from './components/ControlsPanel'
import { useCameraPipeline } from './hooks/useCameraPipeline'
import { useHandTracking } from './hooks/useHandTracking'
import { useMicMonitor } from './hooks/useMicMonitor'

const DEFAULT_API_URL = 'http://127.0.0.1:8000/process'

function App() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL)
  const [fps, setFps] = useState(8)
  const [status, setStatus] = useState('Idle')
  const [monitorLevel, setMonitorLevelState] = useState(0)

  const { overlayCanvasRef, detectHands, clearOverlay, handsCount, handHeight } = useHandTracking(setStatus)

  const { videoRef, canvasRef, cameraOn, processedSrc, startCamera, stopCamera } = useCameraPipeline({
    apiUrl,
    fps,
    detectHands,
    clearOverlay,
    setStatus,
  })

  const {
    micOn,
    audioInputs,
    selectedAudioInputId,
    setSelectedAudioInputId,
    toggleMic,
    setMonitorLevel,
  } = useMicMonitor({ setStatus })

  useEffect(() => {
    if (handsCount === 0) {
      setMonitorLevel(0)
      setMonitorLevelState(0)
      return
    }
    const shapedLevel = Math.min(1.4, Math.pow(handHeight, 1.5) * 1.4)
    setMonitorLevel(shapedLevel)
    setMonitorLevelState(shapedLevel)
  }, [handHeight, handsCount, setMonitorLevel])

  return (
    <main style={{ padding: '24px', textAlign: 'left' }}>
      <h1 style={{ marginBottom: '12px' }}>Camera + OpenCV Bridge</h1>
      <p style={{ marginBottom: '20px' }}>
        Start camera and frames will stream to your OpenCV backend automatically.
      </p>

      <ControlsPanel
        apiUrl={apiUrl}
        setApiUrl={setApiUrl}
        fps={fps}
        setFps={setFps}
        selectedAudioInputId={selectedAudioInputId}
        setSelectedAudioInputId={setSelectedAudioInputId}
        audioInputs={audioInputs}
        cameraOn={cameraOn}
        startCamera={() => {
          void startCamera()
        }}
        stopCamera={stopCamera}
        micOn={micOn}
        toggleMic={toggleMic}
        status={status}
        handsCount={handsCount}
        handHeight={handHeight}
        monitorLevel={monitorLevel}
      />

      <section
        style={{
          display: 'grid',
          gap: '16px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        }}
      >
        <div>
          <h2>Live Camera</h2>
          <div style={{ position: 'relative', border: '1px solid var(--border)' }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              width={640}
              height={400}
              style={{ width: '100%', display: 'block', transform: 'scaleX(-1)' }}
            />
            <canvas
              ref={overlayCanvasRef}
              width={640}
              height={400}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                transform: 'scaleX(-1)',
                pointerEvents: 'none',
              }}
            />
          </div>
        </div>

        <div>
          <h2>Processed Output</h2>
          {processedSrc ? (
            <img
              src={processedSrc}
              alt="Processed frame"
              width={640}
              height={400}
              style={{ width: '100%', border: '1px solid var(--border)' }}
            />
          ) : (
            <div
              style={{
                height: '240px',
                border: '1px dashed var(--border)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              Waiting for frames
            </div>
          )}
        </div>
      </section>

      <canvas ref={canvasRef} width={640} height={480} style={{ display: 'none' }} />
    </main>
  )
}

export default App
