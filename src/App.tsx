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
  const [reverbMix, setReverbMixState] = useState(0)
  const [isRecording, setIsRecording] = useState(false)
  const [recordedSrc, setRecordedSrc] = useState('')
  const [recordingError, setRecordingError] = useState('')
  const [recordingLabel, setRecordingLabel] = useState('')
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)

  const {
    overlayCanvasRef,
    detectHands,
    clearOverlay,
    handsCount,
    handHeight,
    leftHandHeight,
    singleHandPinchMix,
  } = useHandTracking(setStatus)

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
    setReverbMix,
    getMicStream,
    getMonitorStream,
  } = useMicMonitor({ setStatus })

  useEffect(() => {
    if (handsCount === 0) {
      setMonitorLevel(0)
      setMonitorLevelState(0)
      return
    }
    const shapedLevel = Math.min(2, Math.pow(handHeight, 1.8) * 2)
    setMonitorLevel(shapedLevel)
    setMonitorLevelState(shapedLevel)
  }, [handHeight, handsCount, setMonitorLevel])

  useEffect(() => {
    const activeReverbMix = handsCount === 1
      ? singleHandPinchMix
      : leftHandHeight
    setReverbMix(activeReverbMix)
    setReverbMixState(activeReverbMix)
  }, [handsCount, leftHandHeight, setReverbMix, singleHandPinchMix])

  const toggleRecording = () => {
    if (isRecording) {
      mediaRecorder?.stop()
      return
    }

    const videoElement = videoRef.current
    const micStream = getMicStream()
    const monitorStream = getMonitorStream()
    if (!videoElement) {
      setRecordingError('Cannot record: camera element not available.')
      return
    }
    if (!cameraOn) {
      setRecordingError('Start camera before recording.')
      return
    }
    if (!micStream) {
      setRecordingError('Turn mic on before recording.')
      return
    }
    if (!monitorStream) {
      setRecordingError('Processed audio stream unavailable. Turn mic on first.')
      return
    }

    const captureStreamFn = (
      videoElement as HTMLVideoElement & {
        captureStream?: () => MediaStream
        mozCaptureStream?: () => MediaStream
      }
    ).captureStream?.bind(videoElement)
      ?? (
        videoElement as HTMLVideoElement & {
          captureStream?: () => MediaStream
          mozCaptureStream?: () => MediaStream
        }
      ).mozCaptureStream?.bind(videoElement)
    if (!captureStreamFn) {
      setRecordingError('Recording is not supported in this browser.')
      return
    }

    const videoStream = captureStreamFn()
    const combinedStream = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...monitorStream.getAudioTracks(),
    ])
    const chunks: BlobPart[] = []
    const recorder = new MediaRecorder(combinedStream, {
      mimeType: 'video/webm;codecs=vp9,opus',
    })

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        chunks.push(event.data)
      }
    }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const nextUrl = URL.createObjectURL(blob)
      setRecordedSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return nextUrl
      })
      setIsRecording(false)
      setMediaRecorder(null)
      setRecordingLabel(`Recorded ${Math.round(blob.size / 1024)} KB`)
      setRecordingError('')
      combinedStream.getTracks().forEach((track) => track.stop())
    }
    recorder.onerror = () => {
      setIsRecording(false)
      setMediaRecorder(null)
      setRecordingError('Recording failed. Please try again.')
      combinedStream.getTracks().forEach((track) => track.stop())
    }

    setRecordingError('')
    setRecordingLabel('Recording...')
    setIsRecording(true)
    setMediaRecorder(recorder)
    recorder.start(250)
  }

  useEffect(() => {
    return () => {
      if (recordedSrc) URL.revokeObjectURL(recordedSrc)
    }
  }, [recordedSrc])

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
        reverbMix={reverbMix}
        leftHandHeight={leftHandHeight}
        singleHandPinchMix={singleHandPinchMix}
      />

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
        <button type="button" onClick={toggleRecording}>
          {isRecording ? 'Stop Recording' : 'Record Video + Audio'}
        </button>
        {recordingLabel ? <small>{recordingLabel}</small> : null}
        {recordingError ? <small>{recordingError}</small> : null}
      </div>

      <section
        style={{
          display: 'grid',
          gap: '16px',
          gridTemplateColumns: '2fr 1fr',
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
              height={520}
              style={{ width: '100%', display: 'block', transform: 'scaleX(-1)' }}
            />
            <canvas
              ref={overlayCanvasRef}
              width={640}
              height={520}
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
              height={280}
              style={{ width: '100%', maxHeight: '280px', objectFit: 'cover', border: '1px solid var(--border)' }}
            />
          ) : (
            <div
              style={{
                height: '180px',
                border: '1px dashed var(--border)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              Waiting for frames
            </div>
          )}
          {recordedSrc ? (
            <div style={{ marginTop: '12px' }}>
              <h3 style={{ marginTop: 0 }}>Last Recording</h3>
              <video src={recordedSrc} controls style={{ width: '100%', border: '1px solid var(--border)' }} />
            </div>
          ) : null}
        </div>
      </section>

      <canvas ref={canvasRef} width={640} height={480} style={{ display: 'none' }} />
    </main>
  )
}

export default App
