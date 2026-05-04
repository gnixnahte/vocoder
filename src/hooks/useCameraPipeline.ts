import { useEffect, useRef, useState } from 'react'

type UseCameraPipelineArgs = {
  apiUrl: string
  fps: number
  detectHands: (video: HTMLVideoElement) => void
  clearOverlay: () => void
  setStatus: (value: string) => void
}

export function useCameraPipeline({
  apiUrl,
  fps,
  detectHands,
  clearOverlay,
  setStatus,
}: UseCameraPipelineArgs) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const timerRef = useRef<number | null>(null)

  const [cameraOn, setCameraOn] = useState(false)
  const [processedSrc, setProcessedSrc] = useState('')

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
    clearOverlay()
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
    return () => {
      stopCamera()
      setProcessedSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return ''
      })
    }
  }, [])

  return {
    videoRef,
    canvasRef,
    cameraOn,
    processedSrc,
    startCamera,
    stopCamera,
  }
}
