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
  const [handHeight, setHandHeight] = useState(0)
  const [leftHandHeight, setLeftHandHeight] = useState(0)
  const [singleHandPinchMix, setSingleHandPinchMix] = useState(0)

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

    setHandsCount(result.landmarks.length)

    const rightHandIndex = result.handedness.findIndex((entry) => {
      const label = entry[0]?.categoryName?.toLowerCase()
      return label === 'right'
    })
    const leftHandIndex = result.handedness.findIndex((entry) => {
      const label = entry[0]?.categoryName?.toLowerCase()
      return label === 'left'
    })

    const rightWrist = rightHandIndex >= 0 ? result.landmarks[rightHandIndex]?.[0] : undefined
    const leftWrist = leftHandIndex >= 0 ? result.landmarks[leftHandIndex]?.[0] : undefined

    if (result.landmarks.length === 1) {
      const singleHand = result.landmarks[0]
      const singleWrist = result.landmarks[0]?.[0]
      const singleHeight = singleWrist ? Math.max(0, Math.min(1, 1 - singleWrist.y)) : 0
      const thumbTip = singleHand?.[4]
      const indexTip = singleHand?.[8]
      const indexMcp = singleHand?.[5]
      const pinkyMcp = singleHand?.[17]
      const pinchDistance = thumbTip && indexTip
        ? Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y, thumbTip.z - indexTip.z)
        : 0
      const palmWidth = indexMcp && pinkyMcp
        ? Math.hypot(
          indexMcp.x - pinkyMcp.x,
          indexMcp.y - pinkyMcp.y,
          indexMcp.z - pinkyMcp.z,
        )
        : 0
      const normalizedPinch = palmWidth > 0 ? pinchDistance / (palmWidth * 1.15) : 0
      const pinchMix = Math.max(0, Math.min(1, Math.pow(normalizedPinch, 0.85)))
      setHandHeight(singleHeight)
      setLeftHandHeight(leftWrist ? Math.max(0, Math.min(1, 1 - leftWrist.y)) : 0)
      setSingleHandPinchMix(pinchMix)
    } else {
      setHandHeight(rightWrist ? Math.max(0, Math.min(1, 1 - rightWrist.y)) : 0)
      setLeftHandHeight(leftWrist ? Math.max(0, Math.min(1, 1 - leftWrist.y)) : 0)
      setSingleHandPinchMix(0)
    }

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
    setHandHeight(0)
    setLeftHandHeight(0)
    setSingleHandPinchMix(0)
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
    handsCount,
    handHeight,
    leftHandHeight,
    singleHandPinchMix,
  }
}
