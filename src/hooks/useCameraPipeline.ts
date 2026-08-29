import { useCallback, useEffect, useRef, useState } from 'react'
import { CAMERA_HEIGHT, CAMERA_WIDTH } from '../cameraConfig'

type UseCameraPipelineArgs = {
  apiUrl: string
  fps: number
  processingEnabled: boolean
  detectHands: (video: HTMLVideoElement) => void
  clearOverlay: () => void
  setStatus: (value: string) => void
}

export function useCameraPipeline({
  apiUrl,
  fps,
  processingEnabled,
  detectHands,
  clearOverlay,
  setStatus,
}: UseCameraPipelineArgs) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const frameRequestInFlightRef = useRef(false)
  const frameRequestControllerRef = useRef<AbortController | null>(null)
  const detectionFrameRef = useRef<number | null>(null)
  const detectionUsesVideoFrameCallbackRef = useRef(false)
  const detectHandsRef = useRef(detectHands)
  const lastPipelineStatusRef = useRef('')

  const [cameraOn, setCameraOn] = useState(false)
  const [processedSrc, setProcessedSrc] = useState('')

  useEffect(() => {
    detectHandsRef.current = detectHands
  }, [detectHands])

  const updatePipelineStatus = useCallback((value: string) => {
    if (lastPipelineStatusRef.current === value) return
    lastPipelineStatusRef.current = value
    setStatus(value)
  }, [setStatus])

  const stopLoop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    frameRequestControllerRef.current?.abort()
  }, [])

  const stopDetectionLoop = useCallback(() => {
    const frameId = detectionFrameRef.current
    if (frameId === null) return

    const video = videoRef.current
    if (detectionUsesVideoFrameCallbackRef.current && video?.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(frameId)
    } else {
      window.cancelAnimationFrame(frameId)
    }
    detectionFrameRef.current = null
  }, [])

  const startDetectionLoop = useCallback((video: HTMLVideoElement) => {
    stopDetectionLoop()

    if (video.requestVideoFrameCallback) {
      detectionUsesVideoFrameCallbackRef.current = true
      const detectVideoFrame = () => {
        if (video.readyState >= 2) detectHandsRef.current(video)
        detectionFrameRef.current = video.requestVideoFrameCallback(detectVideoFrame)
      }
      detectionFrameRef.current = video.requestVideoFrameCallback(detectVideoFrame)
      return
    }

    detectionUsesVideoFrameCallbackRef.current = false
    let lastVideoTime = -1
    const detectAnimationFrame = () => {
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime
        detectHandsRef.current(video)
      }
      detectionFrameRef.current = window.requestAnimationFrame(detectAnimationFrame)
    }
    detectionFrameRef.current = window.requestAnimationFrame(detectAnimationFrame)
  }, [stopDetectionLoop])

  const stopCamera = useCallback(() => {
    stopLoop()
    stopDetectionLoop()
    const video = videoRef.current
    const stream = video?.srcObject as MediaStream | null
    stream?.getTracks().forEach((track) => track.stop())
    if (video) video.srcObject = null
    clearOverlay()
    setCameraOn(false)
  }, [clearOverlay, stopDetectionLoop, stopLoop])

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: CAMERA_WIDTH, height: CAMERA_HEIGHT },
        audio: false,
      })
      if (!videoRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      startDetectionLoop(videoRef.current)
      setCameraOn(true)
      updatePipelineStatus('Camera started')
    } catch (error) {
      updatePipelineStatus(
        `Camera error: ${error instanceof Error ? error.message : 'unknown error'}`,
      )
    }
  }, [startDetectionLoop, updatePipelineStatus])

  const sendFrame = useCallback(async () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2 || frameRequestInFlightRef.current) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const requestController = new AbortController()
    frameRequestInFlightRef.current = true
    frameRequestControllerRef.current = requestController
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.8)
      })
      if (!blob) return

      const formData = new FormData()
      formData.append('frame', blob, 'frame.jpg')

      const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData,
        signal: requestController.signal,
      })
      if (!response.ok) {
        updatePipelineStatus(`Backend error: ${response.status}`)
        return
      }
      const outBlob = await response.blob()
      if (requestController.signal.aborted) return
      const nextUrl = URL.createObjectURL(outBlob)
      setProcessedSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return nextUrl
      })
      updatePipelineStatus('Processing frames')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      updatePipelineStatus(
        `MediaPipe running. Backend offline: ${error instanceof Error ? error.message : 'unknown error'}`,
      )
    } finally {
      if (frameRequestControllerRef.current === requestController) {
        frameRequestControllerRef.current = null
        frameRequestInFlightRef.current = false
      }
    }
  }, [apiUrl, updatePipelineStatus])

  const startLoop = useCallback(() => {
    const clampedFps = Math.min(30, Math.max(1, fps))
    const intervalMs = Math.floor(1000 / clampedFps)
    stopLoop()
    timerRef.current = window.setInterval(() => {
      void sendFrame()
    }, intervalMs)
    updatePipelineStatus('Sending frames')
  }, [fps, sendFrame, stopLoop, updatePipelineStatus])

  useEffect(() => {
    if (!cameraOn || !processingEnabled) return
    startLoop()
    return stopLoop
  }, [cameraOn, processingEnabled, startLoop, stopLoop])

  useEffect(() => {
    return () => {
      stopCamera()
      setProcessedSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return ''
      })
    }
  }, [stopCamera])

  return {
    videoRef,
    canvasRef,
    cameraOn,
    processedSrc,
    startCamera,
    stopCamera,
  }
}
