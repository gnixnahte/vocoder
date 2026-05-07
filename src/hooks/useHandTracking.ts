import { useEffect, useRef, useState } from 'react'
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision'

const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17], [0, 17],
]

export function useHandTracking(setStatus: (value: string) => void) {
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const handLandmarkerRef = useRef<HandLandmarker | null>(null)
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

    overlayCtx.strokeStyle = '#ff2d2d'
    overlayCtx.lineWidth = 2
    overlayCtx.lineCap = 'round'
    overlayCtx.lineJoin = 'round'
    overlayCtx.fillStyle = '#ffffff'
    for (const hand of result.landmarks) {
      for (const [startIndex, endIndex] of HAND_CONNECTIONS) {
        const start = hand[startIndex]
        const end = hand[endIndex]
        if (!start || !end) continue
        overlayCtx.beginPath()
        overlayCtx.moveTo(start.x * overlayCanvas.width, start.y * overlayCanvas.height)
        overlayCtx.lineTo(end.x * overlayCanvas.width, end.y * overlayCanvas.height)
        overlayCtx.stroke()
      }

      for (const landmark of hand) {
        const x = landmark.x * overlayCanvas.width
        const y = landmark.y * overlayCanvas.height
        overlayCtx.beginPath()
        overlayCtx.arc(x, y, 4, 0, Math.PI * 2)
        overlayCtx.fill()
      }
    }
  }

  const clearOverlay = () => {
    const overlayCtx = overlayCanvasRef.current?.getContext('2d')
    if (overlayCtx && overlayCanvasRef.current) {
      overlayCtx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height)
    }
    setHandsCount(0)
  }

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
  }, [setStatus])

  return { 
    overlayCanvasRef,
    detectHands, 
    clearOverlay, 
    handsCount 
  }
}
