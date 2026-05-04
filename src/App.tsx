import { useEffect, useRef, useState } from 'react'
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision'
import './App.css'

const DEFAULT_API_URL = 'http://127.0.0.1:8000/process'

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const handLandmarkerRef = useRef<HandLandmarker | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const micGainRef = useRef<GainNode | null>(null)

  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL)
  const [fps, setFps] = useState(8)
  const [cameraOn, setCameraOn] = useState(false)
  const [micOn, setMicOn] = useState(false)
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([])
  const [selectedAudioInputId, setSelectedAudioInputId] = useState('')
  const [processedSrc, setProcessedSrc] = useState('')
  const [status, setStatus] = useState('Idle')
  const [handsCount, setHandsCount] = useState(0)

  const detectHands = (video: HTMLVideoElement) => {
    const handLandmarker = handLandmarkerRef.current
    const overlayCanvas = overlayCanvasRef.current
    if (!handLandmarker || !overlayCanvas) return

    if (overlayCanvas.width !== video.videoWidth || overlayCanvas.height !== video.videoHeight) {
      overlayCanvas.width = video.videoWidth
      overlayCanvas.height = video.videoHeight
    }

    const overlayCtx = overlayCanvas.getContext('2d')
    if (!overlayCtx) return

    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)

    const result: HandLandmarkerResult = handLandmarker.detectForVideo(
      video,
      performance.now(),
    )
    setHandsCount(result.handedness.length)

    overlayCtx.fillStyle = '#ffffff'
    for (const hand of result.landmarks) {
      for (const landmark of hand) {
        const x = landmark.x * overlayCanvas.width
        const y = landmark.y * overlayCanvas.height
        overlayCtx.beginPath()
        overlayCtx.arc(x, y, 4, 0, Math.PI * 2)
        overlayCtx.fill()
      }
    }
  }

  const stopLoop = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const stopCamera = () => {
    stopLoop()
    const video = videoRef.current
    const stream = video?.srcObject as MediaStream | null
    stream?.getTracks().forEach((track) => track.stop())
    if (video) video.srcObject = null
    const overlayCtx = overlayCanvasRef.current?.getContext('2d')
    if (overlayCtx && overlayCanvasRef.current) {
      overlayCtx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height)
    }
    setHandsCount(0)
    setCameraOn(false)
  }

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      })
      if (!videoRef.current) return
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setCameraOn(true)
      setStatus('Camera started. Processing...')
    } catch (error) {
      setStatus(`Camera error: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  const getAudioContext = () => {
    if (audioContextRef.current) return audioContextRef.current
    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) {
      throw new Error('Web Audio API is not supported in this browser.')
    }
    const audioContext = new AudioContextCtor({
      latencyHint: 'interactive',
    })
    audioContextRef.current = audioContext
    return audioContext
  }

  const fadeMicGain = (targetValue: number) => {
    const audioContext = audioContextRef.current
    const gainNode = micGainRef.current
    if (!audioContext || !gainNode) return
    const now = audioContext.currentTime
    gainNode.gain.cancelScheduledValues(now)
    gainNode.gain.setValueAtTime(gainNode.gain.value, now)
    gainNode.gain.linearRampToValueAtTime(targetValue, now + 0.03)
  }

  const stopMic = () => {
    fadeMicGain(0)
    window.setTimeout(() => {
      micSourceRef.current?.disconnect()
      micGainRef.current?.disconnect()
      micStreamRef.current?.getTracks().forEach((track) => track.stop())
      micSourceRef.current = null
      micGainRef.current = null
      micStreamRef.current = null
      setMicOn(false)
      setStatus('Mic off')
    }, 50)
  }

  const refreshAudioInputs = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const nextInputs = devices.filter((device) => device.kind === 'audioinput')
      setAudioInputs(nextInputs)
      setSelectedAudioInputId((currentId) => {
        if (!nextInputs.length) return ''
        if (currentId && nextInputs.some((device) => device.deviceId === currentId)) {
          return currentId
        }
        return nextInputs[0].deviceId
      })
    } catch (error) {
      setStatus(
        `Device list error: ${error instanceof Error ? error.message : 'unknown error'}`,
      )
    }
  }

  const startMic = async (deviceId?: string) => {
    try {
      const audioContext = getAudioContext()
      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
        video: false,
      })
      const source = audioContext.createMediaStreamSource(stream)
      const gainNode = audioContext.createGain()
      gainNode.gain.value = 0
      source.connect(gainNode)
      gainNode.connect(audioContext.destination)

      micStreamRef.current = stream
      micSourceRef.current = source
      micGainRef.current = gainNode
      setMicOn(true)
      await refreshAudioInputs()
      setStatus('Mic on (monitoring live audio)')
      fadeMicGain(1)
    } catch (error) {
      setStatus(`Mic error: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  const sendFrame = async () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return
    detectHands(video)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.8)
    })
    if (!blob) return

    const formData = new FormData()
    formData.append('frame', blob, 'frame.jpg')

    try {
      const response = await fetch(apiUrl, { method: 'POST', body: formData })
      if (!response.ok) {
        setStatus(`Backend error: ${response.status}`)
        return
      }
      const outBlob = await response.blob()
      const nextUrl = URL.createObjectURL(outBlob)
      setProcessedSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return nextUrl
      })
      setStatus('Processing frames')
    } catch (error) {
      setStatus(
        `MediaPipe running. Backend offline: ${error instanceof Error ? error.message : 'unknown error'}`,
      )
    }
  }

  const startLoop = () => {
    const clampedFps = Math.min(30, Math.max(1, fps))
    const intervalMs = Math.floor(1000 / clampedFps)
    stopLoop()
    timerRef.current = window.setInterval(() => {
      void sendFrame()
    }, intervalMs)
    setStatus('Sending frames')
  }

  useEffect(() => {
    if (!cameraOn) return
    startLoop()
    return stopLoop
  }, [cameraOn, fps, apiUrl])

  useEffect(() => {
    let isMounted = true
    const initHands = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
        )
        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          },
          runningMode: 'VIDEO',
          numHands: 2,
        })
        if (!isMounted) {
          handLandmarker.close()
          return
        }
        handLandmarkerRef.current = handLandmarker
        setStatus('MediaPipe Hands ready')
      } catch (error) {
        setStatus(
          `MediaPipe error: ${error instanceof Error ? error.message : 'unknown error'}`,
        )
      }
    }
    void initHands()
    return () => {
      isMounted = false
      handLandmarkerRef.current?.close()
      handLandmarkerRef.current = null
    }
  }, [])

  useEffect(() => {
    void refreshAudioInputs()
    const mediaDevices = navigator.mediaDevices
    if (!mediaDevices) return

    const handleDeviceChange = () => {
      void refreshAudioInputs()
    }
    mediaDevices.addEventListener('devicechange', handleDeviceChange)
    return () => {
      mediaDevices.removeEventListener('devicechange', handleDeviceChange)
    }
  }, [])

  useEffect(() => {
    if (!micOn) return
    stopMic()
    window.setTimeout(() => {
      void startMic(selectedAudioInputId)
    }, 60)
  }, [selectedAudioInputId])

  useEffect(() => {
    return () => {
      stopCamera()
      stopMic()
      void audioContextRef.current?.close()
      audioContextRef.current = null
      setProcessedSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return ''
      })
    }
  }, [])

  return (
    <main style={{ padding: '24px', textAlign: 'left' }}>
      <h1 style={{ marginBottom: '12px' }}>Camera + OpenCV Bridge</h1>
      <p style={{ marginBottom: '20px' }}>
        Start camera and frames will stream to your OpenCV backend automatically.
      </p>

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
          <button type="button" onClick={() => void startCamera()} disabled={cameraOn}>
            Start Camera
          </button>
          <button type="button" onClick={stopCamera} disabled={!cameraOn}>
            Stop Camera
          </button>
          <button
            type="button"
            onClick={() => {
              if (micOn) {
                stopMic()
                return
              }
              void startMic(selectedAudioInputId)
            }}
          >
            {micOn ? 'Mic Off' : 'Mic On'}
          </button>
        </div>

        <small>Status: {status}</small>
        <small>Hands detected: {handsCount}</small>
      </section>

      <section style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <div>
          <h2>Live Camera</h2>
          <div style={{ position: 'relative', border: '1px solid var(--border)' }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              width={640}
              height={480}
              style={{ width: '100%', display: 'block', transform: 'scaleX(-1)' }}
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
          </div>
        </div>

        <div>
          <h2>Processed Output</h2>
          {processedSrc ? (
            <img src={processedSrc} alt="Processed frame" width={640} height={480} style={{ width: '100%', border: '1px solid var(--border)' }} />
          ) : (
            <div style={{ height: '240px', border: '1px dashed var(--border)', display: 'grid', placeItems: 'center' }}>
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
