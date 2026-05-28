import { useEffect, useRef, useState } from 'react'
import lamejs from 'lamejs'
import './App.css'
import { ControlsPanel } from './components/ControlsPanel'
import { useCameraPipeline } from './hooks/useCameraPipeline'
import { useHandTracking } from './hooks/useHandTracking'
import { useMicMonitor } from './hooks/useMicMonitor'

const DEFAULT_API_URL = 'http://127.0.0.1:8000/process'
const DEFAULT_TREMOLO_DEPTH = 0
const BASE_TREMOLO_RATE_HZ = 8.5
const TREMOLO_RATE_SWEEP_HZ = 5.5
type ViewMode = 'raw' | 'processed' | 'split'

function App() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL)
  const [fps, setFps] = useState(8)
  const [status, setStatus] = useState('Idle')
  const [monitorLevel, setMonitorLevelState] = useState(0)
  const [reverbMix, setReverbMixState] = useState(0)
  const [isRecording, setIsRecording] = useState(false)
  const [recordedSrc, setRecordedSrc] = useState('')
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordingError, setRecordingError] = useState('')
  const [recordingLabel, setRecordingLabel] = useState('')
  const [isExtractingMp3, setIsExtractingMp3] = useState(false)
  const [mp3Error, setMp3Error] = useState('')
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const countdownTimerRef = useRef<number | null>(null)

  const {
    overlayCanvasRef,
    detectHands,
    clearOverlay,
    handsCount,
    handHeight,
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
    setTremoloDepth,
    setTremoloRate,
    getMicStream,
    getMonitorStream,
  } = useMicMonitor({ setStatus })

  useEffect(() => {
    if (handHeight <= 0) {
      setMonitorLevel(0)
      setMonitorLevelState(0)
      return
    }
    const shapedLevel = Math.min(2, Math.pow(handHeight, 1.8) * 2)
    setMonitorLevel(shapedLevel)
    setMonitorLevelState(shapedLevel)
  }, [handHeight, setMonitorLevel])

  useEffect(() => {
    const activeReverbMix = handsCount === 1 ? singleHandPinchMix : leftHandHeight
    setReverbMix(activeReverbMix)
    setReverbMixState(activeReverbMix)
  }, [handsCount, leftHandHeight, setReverbMix, singleHandPinchMix])

  useEffect(() => {
    let gestureDepth = 0

    if (handsCount === 1) {
      // One-hand mode: only allow tremolo when the hand is a forward-facing fist.
      gestureDepth = singleHandFistForward ? singleHandRotation : 0
    } else {
      // Two-hand mode (or any non-one-hand case):
      // only allow tremolo when the left hand is a forward fist.
      if (leftHandFistForward) {
        gestureDepth = leftHandRotation
      } else {
        gestureDepth = 0
      }
    }

    const tremoloDepth = DEFAULT_TREMOLO_DEPTH + gestureDepth * (1 - DEFAULT_TREMOLO_DEPTH)
    setTremoloDepth(tremoloDepth)
  }, [
    handsCount,
    leftHandFistForward,
    leftHandRotation,
    setTremoloDepth,
    singleHandFistForward,
    singleHandRotation,
  ])

  useEffect(() => {
    let tiltAmount = 0

    if (handsCount === 1) {
      tiltAmount = singleHandFistForward ? singleHandForwardTilt : 0
    } else if (leftHandFistForward) {
      tiltAmount = leftHandForwardTilt
    }

    const tremoloRateHz = BASE_TREMOLO_RATE_HZ + tiltAmount * TREMOLO_RATE_SWEEP_HZ
    setTremoloRate(tremoloRateHz)
  }, [
    handsCount,
    leftHandFistForward,
    leftHandForwardTilt,
    setTremoloRate,
    singleHandFistForward,
    singleHandForwardTilt,
  ])

  const beginRecording = () => {
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
      setRecordedBlob(blob)
      setRecordedSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return nextUrl
      })
      setIsRecording(false)
      setMediaRecorder(null)
      setRecordingLabel(`Recorded ${Math.round(blob.size / 1024)} KB`)
      setRecordingError('')
      setMp3Error('')
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

  const clearCountdownTimer = () => {
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
  }

  const toggleRecording = () => {
    if (isRecording) {
      beginRecording()
      return
    }

    if (countdown !== null) {
      clearCountdownTimer()
      setCountdown(null)
      setRecordingLabel('')
      return
    }

    setRecordingError('')
    setRecordingLabel('Starting in...')
    setCountdown(3)
    countdownTimerRef.current = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev === null) return null
        if (prev <= 1) {
          clearCountdownTimer()
          beginRecording()
          return null
        }
        return prev - 1
      })
    }, 1000)
  }

  useEffect(() => {
    return () => {
      if (recordedSrc) URL.revokeObjectURL(recordedSrc)
      clearCountdownTimer()
    }
  }, [recordedSrc])

  const extractMp3 = async () => {
    if (!recordedBlob) return
    setIsExtractingMp3(true)
    setMp3Error('')
    let audioContext: AudioContext | null = null
    try {
      audioContext = new AudioContext()
      const arrayBuffer = await recordedBlob.arrayBuffer()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
      const channelData = audioBuffer.getChannelData(0)
      const sampleRate = audioBuffer.sampleRate
      const samples = new Int16Array(channelData.length)
      for (let i = 0; i < channelData.length; i += 1) {
        const clamped = Math.max(-1, Math.min(1, channelData[i]))
        samples[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
      }

      const encoder = new lamejs.Mp3Encoder(1, sampleRate, 128)
      const mp3Chunks: BlobPart[] = []
      const blockSize = 1152
      for (let i = 0; i < samples.length; i += blockSize) {
        const chunk = samples.subarray(i, i + blockSize)
        const mp3buf = encoder.encodeBuffer(chunk)
        if (mp3buf.length > 0) mp3Chunks.push(Uint8Array.from(mp3buf))
      }
      const end = encoder.flush()
      if (end.length > 0) mp3Chunks.push(Uint8Array.from(end))

      const mp3Blob = new Blob(mp3Chunks, { type: 'audio/mpeg' })
      const downloadUrl = URL.createObjectURL(mp3Blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `recording-${Date.now()}.mp3`
      link.click()
      URL.revokeObjectURL(downloadUrl)
    } catch {
      setMp3Error('Could not extract MP3 from this recording.')
    } finally {
      if (audioContext) {
        await audioContext.close()
      }
      setIsExtractingMp3(false)
    }
  }

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
        isOpenPalmForward={isOpenPalmForward}
        isFistForward={isFistForward}
        isFistSide={isFistSide}
        isFistSideLeft={isFistSideLeft}
        isFistSideRight={isFistSideRight}
        leftHandFistForward={leftHandFistForward}
        singleHandFistForward={singleHandFistForward}
        leftHandRotation={leftHandRotation}
        singleHandRotation={singleHandRotation}
        leftHandForwardTilt={leftHandForwardTilt}
        singleHandForwardTilt={singleHandForwardTilt}
      />

      <section style={{ maxWidth: '700px', margin: '0 auto' }}>
        <h2>Live Camera</h2>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setViewMode('raw')} disabled={viewMode === 'raw'}>
            Raw
          </button>
          <button
            type="button"
            onClick={() => setViewMode('processed')}
            disabled={viewMode === 'processed'}
          >
            Processed
          </button>
          <button type="button" onClick={() => setViewMode('split')} disabled={viewMode === 'split'}>
            Split
          </button>
        </div>
        <div
          style={{
            border: '1px solid var(--border)',
            background: '#000',
            display: 'grid',
            gridTemplateColumns: viewMode === 'split' ? '1fr 1fr' : '1fr',
          }}
        >
          {viewMode !== 'processed' ? (
            <div style={{ position: 'relative', aspectRatio: '4 / 3' }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                width={640}
                height={480}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  display: 'block',
                  transform: 'scaleX(-1)',
                  background: '#000',
                }}
              />
              <canvas
                ref={overlayCanvasRef}
                width={640}
                height={480}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  transform: 'scaleX(-1)',
                  pointerEvents: 'none',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: '10px',
                  bottom: '10px',
                  background: 'rgba(0, 0, 0, 0.65)',
                  color: '#f3f4f6',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  lineHeight: 1.35,
                }}
              >
                <div>Gesture: {isOpenPalmForward ? 'Open Palm' : isFistForward ? 'Fist Forward' : isFistSide ? 'Fist Side' : 'None'}</div>
                <div>Hands: {handsCount}</div>
                <div>Monitor: {monitorLevel.toFixed(2)}</div>
                <div>Reverb: {reverbMix.toFixed(2)}</div>
              </div>
            </div>
          ) : null}
          {viewMode !== 'raw' ? (
            <div style={{ position: 'relative', aspectRatio: '4 / 3', borderLeft: viewMode === 'split' ? '1px solid #222' : undefined }}>
              {processedSrc ? (
                <img
                  src={processedSrc}
                  alt="Processed output"
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                />
              ) : (
                <div style={{ color: '#d1d5db', display: 'grid', placeItems: 'center', height: '100%' }}>
                  No processed frame yet
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'grid', placeItems: 'center', marginTop: '16px', gap: '8px' }}>
          {countdown !== null ? <div style={{ fontSize: '28px', fontWeight: 700 }}>{countdown}</div> : null}
          <button
            type="button"
            onClick={toggleRecording}
            style={{
              width: '72px',
              height: '72px',
              borderRadius: '50%',
              border: '2px solid #e8e8e8',
              background: isRecording ? '#8d1010' : '#d61f1f',
              cursor: 'pointer',
            }}
            aria-label={isRecording ? 'Stop recording' : 'Start recording'}
          />
          {recordingLabel ? <small>{recordingLabel}</small> : null}
          {recordingError ? <small>{recordingError}</small> : null}
        </div>

        {recordedSrc ? (
          <div style={{ marginTop: '14px' }}>
            <h3 style={{ marginTop: 0 }}>Last Recording</h3>
            <video src={recordedSrc} controls style={{ width: '100%', border: '1px solid var(--border)' }} />
            <div style={{ marginTop: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button type="button" onClick={() => { void extractMp3() }} disabled={isExtractingMp3}>
                {isExtractingMp3 ? 'Extracting MP3...' : 'Extract audio as MP3'}
              </button>
              {mp3Error ? <small>{mp3Error}</small> : null}
            </div>
          </div>
        ) : null}
      </section>

      <canvas ref={canvasRef} width={640} height={480} style={{ display: 'none' }} />
    </main>
  )
}

export default App
