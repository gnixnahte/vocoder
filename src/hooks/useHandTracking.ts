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

type LandmarkPoint = { x: number; y: number; z: number }
type GestureLabel = 'none' | 'open_palm_forward' | 'fist_forward' | 'fist_side'
type SideDirection = 'none' | 'left' | 'right'

const distance3 = (a: LandmarkPoint, b: LandmarkPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

const handRotationAmount = (hand: LandmarkPoint[]) => {
  const indexMcp = hand[5]
  const pinkyMcp = hand[17]
  if (!indexMcp || !pinkyMcp) return 0
  const dx = pinkyMcp.x - indexMcp.x
  const dy = pinkyMcp.y - indexMcp.y
  const angle = Math.abs(Math.atan2(dy, dx))
  return Math.max(0, Math.min(1, angle / (Math.PI / 2)))
}

const handForwardTiltAmount = (hand: LandmarkPoint[]) => {
  const wrist = hand[0]
  const middleMcp = hand[9]
  const indexMcp = hand[5]
  const pinkyMcp = hand[17]
  if (!wrist || !middleMcp || !indexMcp || !pinkyMcp) return 0

  const palmWidth = distance3(indexMcp, pinkyMcp)
  if (palmWidth <= 1e-6) return 0

  // MediaPipe z is camera-relative depth; compare knuckles to wrist and normalize by hand size.
  const pitchNormalized = (wrist.z - middleMcp.z) / palmWidth
  const minPitch = 0.04
  const maxPitch = 0.5
  const mapped = (pitchNormalized - minPitch) / (maxPitch - minPitch)
  return Math.max(0, Math.min(1, mapped))
}

const angleBetween = (a: LandmarkPoint, b: LandmarkPoint, c: LandmarkPoint) => {
  const abx = a.x - b.x
  const aby = a.y - b.y
  const abz = a.z - b.z
  const cbx = c.x - b.x
  const cby = c.y - b.y
  const cbz = c.z - b.z
  const dot = abx * cbx + aby * cby + abz * cbz
  const magAb = Math.hypot(abx, aby, abz)
  const magCb = Math.hypot(cbx, cby, cbz)
  if (magAb === 0 || magCb === 0) return Math.PI
  const cosine = Math.max(-1, Math.min(1, dot / (magAb * magCb)))
  return Math.acos(cosine)
}

const isFingerExtended = (
  hand: LandmarkPoint[],
  tipIndex: number,
  pipIndex: number,
  mcpIndex: number,
) => {
  const tip = hand[tipIndex]
  const pip = hand[pipIndex]
  const mcp = hand[mcpIndex]
  const wrist = hand[0]
  if (!tip || !pip || !mcp || !wrist) return false
  const tipToWrist = distance3(tip, wrist)
  const pipToWrist = distance3(pip, wrist)
  const mcpToWrist = distance3(mcp, wrist)
  return tipToWrist > pipToWrist && pipToWrist > mcpToWrist
}

const isFingerCurled = (
  hand: LandmarkPoint[],
  tipIndex: number,
  pipIndex: number,
  mcpIndex: number,
) => {
  const tip = hand[tipIndex]
  const pip = hand[pipIndex]
  const mcp = hand[mcpIndex]
  const dip = hand[pipIndex + 1]
  if (!tip || !pip || !mcp) return false
  const tipToMcp = distance3(tip, mcp)
  const pipToMcp = distance3(pip, mcp)
  const isDistanceCurled = tipToMcp < pipToMcp * 1.05
  if (!dip) return isDistanceCurled

  const pipBend = angleBetween(mcp, pip, dip)
  const dipBend = angleBetween(pip, dip, tip)
  const isAngleCurled = pipBend < 2.35 || dipBend < 2.45
  return isDistanceCurled || isAngleCurled
}

const analyzeHandShape = (hand: LandmarkPoint[]) => {
  const wrist = hand[0]
  const indexMcp = hand[5]
  const middleMcp = hand[9]
  const pinkyMcp = hand[17]
  if (!wrist || !indexMcp || !middleMcp || !pinkyMcp) {
    return {
      isOpenPalmForward: false,
      isFistForward: false,
      isFistSide: false,
      sideDirection: 'none' as SideDirection,
      forwardScore: 0,
      sideScore: 0,
    }
  }

  const openFingersCount = [
    isFingerExtended(hand, 8, 6, 5),
    isFingerExtended(hand, 12, 10, 9),
    isFingerExtended(hand, 16, 14, 13),
    isFingerExtended(hand, 20, 18, 17),
  ].filter(Boolean).length
  const curledFingersCount = [
    isFingerCurled(hand, 8, 6, 5),
    isFingerCurled(hand, 12, 10, 9),
    isFingerCurled(hand, 16, 14, 13),
    isFingerCurled(hand, 20, 18, 17),
  ].filter(Boolean).length

  const thumbTip = hand[4]
  const indexTip = hand[8]
  const middleTip = hand[12]
  const ringTip = hand[16]
  const pinkyTip = hand[20]
  const fingertips = [thumbTip, indexTip, middleTip, ringTip, pinkyTip].filter(
    Boolean,
  ) as LandmarkPoint[]
  const avgTipToWrist = fingertips.length
    ? fingertips.reduce((sum, point) => sum + distance3(point, wrist), 0) / fingertips.length
    : 0
  const palmWidth = distance3(indexMcp, pinkyMcp)
  const depthSpread = Math.max(...hand.map((p) => p.z)) - Math.min(...hand.map((p) => p.z))
  const knuckleWidth = distance3(hand[5], hand[17])
  const knuckleHeightSpread =
    Math.max(hand[5].y, hand[9].y, hand[13].y, hand[17].y)
    - Math.min(hand[5].y, hand[9].y, hand[13].y, hand[17].y)
  const fingertipClusterSpread = Math.max(
    distance3(hand[8], hand[12]),
    distance3(hand[12], hand[16]),
    distance3(hand[16], hand[20]),
    distance3(hand[8], hand[20]),
  )
  const handMinX = Math.min(...hand.map((p) => p.x))
  const handMaxX = Math.max(...hand.map((p) => p.x))
  const handMinY = Math.min(...hand.map((p) => p.y))
  const handMaxY = Math.max(...hand.map((p) => p.y))
  const handWidth = handMaxX - handMinX
  const handHeight = handMaxY - handMinY
  const sideSilhouette = handHeight > 0 && handWidth / handHeight < 0.68

  // Palm-plane normal z magnitude helps estimate front-facing palm.
  const ax = indexMcp.x - wrist.x
  const ay = indexMcp.y - wrist.y
  const bx = pinkyMcp.x - wrist.x
  const by = pinkyMcp.y - wrist.y
  const nz = ax * by - ay * bx
  const frontFacingPalm = Math.abs(nz) > 0.012 && depthSpread < 0.28

  const openPalmForward = openFingersCount >= 4 && frontFacingPalm && avgTipToWrist > palmWidth * 1.4
  const closedFist =
    (curledFingersCount >= 3 && avgTipToWrist < palmWidth * 1.65)
    || (openFingersCount <= 1 && avgTipToWrist < palmWidth * 1.35)
    || (openFingersCount <= 2 && avgTipToWrist < palmWidth * 1.85 && handWidth / handHeight < 0.86)
  const compactKnuckles = knuckleWidth > 0 && knuckleHeightSpread / knuckleWidth < 0.42
  const fistForward = closedFist && (frontFacingPalm || (compactKnuckles && depthSpread < 0.2))
  const depthToWidth = palmWidth > 0 ? depthSpread / palmWidth : 0
  const sideFacingPalm = Math.abs(nz) <= 0.03
  const sideProfileStrong = sideSilhouette || depthToWidth > 0.32
  const compactFingertips =
    fingertipClusterSpread < palmWidth * 1.2
    && avgTipToWrist < palmWidth * 1.75
  // Sideways closed fists can occlude joints and under-count curled fingers.
  const closedSideEvidence =
    openFingersCount <= 2
    && compactFingertips
    && (sideFacingPalm || sideProfileStrong || handWidth / handHeight < 0.92)
    && avgTipToWrist < palmWidth * 1.95
  const closedHand = closedFist || closedSideEvidence
  const sideFistFallback =
    compactKnuckles
    && fingertipClusterSpread < palmWidth * 1.05
    && handWidth / handHeight < 1.02
  const rawFistSide =
    closedHand
    && compactFingertips
    && (sideFacingPalm || sideFistFallback || sideProfileStrong)
    && (depthSpread >= 0.038 || sideSilhouette || sideFistFallback || depthToWidth > 0.26)
  const fistSide = rawFistSide && !fistForward
  const knuckleCenterX = (hand[5].x + hand[9].x + hand[13].x + hand[17].x) / 4
  const tipCenterX = (hand[8].x + hand[12].x + hand[16].x + hand[20].x) / 4
  const lateralOffset = tipCenterX - knuckleCenterX
  const lateralThreshold = Math.max(0.015, handWidth * 0.08)
  const sideDirection: SideDirection = fistSide && Math.abs(lateralOffset) > lateralThreshold
    ? (lateralOffset > 0 ? 'right' : 'left')
    : 'none'

  // Confidence-like values for stable conflict resolution across adjacent poses.
  const forwardScore =
    (frontFacingPalm ? 1.2 : 0)
    + (compactKnuckles ? 0.6 : 0)
    + (depthSpread < 0.2 ? 0.4 : 0)
  const sideScore =
    (sideFacingPalm ? 1.0 : 0)
    + (sideSilhouette ? 0.8 : 0)
    + (sideProfileStrong ? 0.5 : 0)
    + (sideFistFallback ? 1.0 : 0)
    + (depthSpread >= 0.045 ? 0.3 : 0)

  return {
    isOpenPalmForward: openPalmForward,
    isFistForward: fistForward,
    isFistSide: fistSide,
    sideDirection,
    forwardScore,
    sideScore,
  }
}

export function useHandTracking(setStatus: (value: string) => void) {
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const handLandmarkerRef = useRef<HandLandmarker | null>(null)
  const lastGestureStatusRef = useRef('')
  const singleHandPinchMinRef = useRef(0.25)
  const singleHandPinchMaxRef = useRef(0.85)
  const [handsCount, setHandsCount] = useState(0)
  const [handHeight, setHandHeight] = useState(0)
  const [leftHandHeight, setLeftHandHeight] = useState(0)
  const [singleHandPinchMix, setSingleHandPinchMix] = useState(0)
  const [isOpenPalmForward, setIsOpenPalmForward] = useState(false)
  const [isFistForward, setIsFistForward] = useState(false)
  const [isFistSide, setIsFistSide] = useState(false)
  const [isFistSideLeft, setIsFistSideLeft] = useState(false)
  const [isFistSideRight, setIsFistSideRight] = useState(false)
  const [leftHandFistForward, setLeftHandFistForward] = useState(false)
  const [rightHandClosedFist, setRightHandClosedFist] = useState(false)
  const [singleHandFistForward, setSingleHandFistForward] = useState(false)
  const [leftHandRotation, setLeftHandRotation] = useState(0)
  const [singleHandRotation, setSingleHandRotation] = useState(0)
  const [leftHandForwardTilt, setLeftHandForwardTilt] = useState(0)
  const [singleHandForwardTilt, setSingleHandForwardTilt] = useState(0)
  const stableGestureRef = useRef<GestureLabel>('none')
  const gestureCandidateRef = useRef<GestureLabel>('none')
  const candidateFramesRef = useRef(0)

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
    const leftHand = leftHandIndex >= 0 ? (result.landmarks[leftHandIndex] as LandmarkPoint[]) : undefined
    const primaryHand = result.landmarks[0] as LandmarkPoint[] | undefined
    const shape: ReturnType<typeof analyzeHandShape> = primaryHand
      ? analyzeHandShape(primaryHand)
      : {
        isOpenPalmForward: false,
        isFistForward: false,
        isFistSide: false,
        sideDirection: 'none' as SideDirection,
        forwardScore: 0,
        sideScore: 0,
      }

    // Resolve fist-forward vs fist-side with margin to prevent mixed classifications.
    let instantaneousGesture: GestureLabel = 'none'
    if (shape.isOpenPalmForward) {
      instantaneousGesture = 'open_palm_forward'
    } else if (shape.isFistForward || shape.isFistSide) {
      const scoreDiff = shape.sideScore - shape.forwardScore
      if (scoreDiff > 0.2 && shape.isFistSide) {
        instantaneousGesture = 'fist_side'
      } else if (scoreDiff < -0.2 && shape.isFistForward) {
        instantaneousGesture = 'fist_forward'
      } else if (shape.isFistSide && !shape.isFistForward) {
        instantaneousGesture = 'fist_side'
      } else if (shape.isFistForward) {
        instantaneousGesture = 'fist_forward'
      }
    }

    // Hysteresis: require fewer frames to keep state, more to switch state.
    if (gestureCandidateRef.current === instantaneousGesture) {
      candidateFramesRef.current += 1
    } else {
      gestureCandidateRef.current = instantaneousGesture
      candidateFramesRef.current = 1
    }

    const currentStable = stableGestureRef.current
    const switching = gestureCandidateRef.current !== currentStable
    const framesNeeded = switching ? 3 : 2
    if (candidateFramesRef.current >= framesNeeded) {
      stableGestureRef.current = gestureCandidateRef.current
    }

    const stableGesture = stableGestureRef.current
    setIsOpenPalmForward(stableGesture === 'open_palm_forward')
    setIsFistForward(stableGesture === 'fist_forward')
    setIsFistSide(stableGesture === 'fist_side')
    const stableSideDirection = stableGesture === 'fist_side' ? shape.sideDirection : 'none'
    setIsFistSideLeft(stableSideDirection === 'left')
    setIsFistSideRight(stableSideDirection === 'right')

    const gestureStatus = stableGesture === 'fist_side'
      ? 'Gesture: Fist Side'
      : stableGesture === 'fist_forward'
        ? 'Gesture: Fist Forward'
        : stableGesture === 'open_palm_forward'
          ? 'Gesture: Open Palm Forward'
          : 'Gesture: None'
    if (gestureStatus !== lastGestureStatusRef.current) {
      lastGestureStatusRef.current = gestureStatus
      setStatus(gestureStatus)
    }

    const rightHandHeight = rightWrist ? Math.max(0, Math.min(1, 1 - rightWrist.y)) : 0
    const nextLeftHandHeight = leftWrist ? Math.max(0, Math.min(1, 1 - leftWrist.y)) : 0
    const primaryWrist = result.landmarks[0]?.[0]
    const primaryHandHeight = primaryWrist ? Math.max(0, Math.min(1, 1 - primaryWrist.y)) : 0
    const activeHandHeight = result.landmarks.length === 1
      ? primaryHandHeight
      : rightHandHeight
    setHandHeight(activeHandHeight)
    setLeftHandHeight(nextLeftHandHeight)
    const leftShape = leftHand ? analyzeHandShape(leftHand) : null
    const rightHand = rightHandIndex >= 0 ? (result.landmarks[rightHandIndex] as LandmarkPoint[]) : undefined
    const rightShape = rightHand ? analyzeHandShape(rightHand) : null
    setLeftHandFistForward(Boolean(leftShape?.isFistForward))
    setRightHandClosedFist(Boolean(rightShape?.isFistForward || rightShape?.isFistSide))
    setLeftHandRotation(leftHand ? handRotationAmount(leftHand) : 0)
    setLeftHandForwardTilt(leftHand ? handForwardTiltAmount(leftHand) : 0)

    if (result.landmarks.length === 1) {
      const singleHand = result.landmarks[0]
      const singleShape = analyzeHandShape(singleHand as LandmarkPoint[])
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
      const normalizedPinch = palmWidth > 0 ? pinchDistance / palmWidth : 0

      // Adaptive one-hand calibration with slow decay to avoid sticky outlier max/min.
      if (normalizedPinch > 0) {
        const followRate = 0.01
        if (normalizedPinch < singleHandPinchMinRef.current) {
          singleHandPinchMinRef.current = normalizedPinch
        } else {
          singleHandPinchMinRef.current +=
            (normalizedPinch - singleHandPinchMinRef.current) * followRate
        }

        if (normalizedPinch > singleHandPinchMaxRef.current) {
          singleHandPinchMaxRef.current = normalizedPinch
        } else {
          singleHandPinchMaxRef.current +=
            (normalizedPinch - singleHandPinchMaxRef.current) * followRate
        }
      }
      const dynamicMin = singleHandPinchMinRef.current + 0.02
      const dynamicMax = singleHandPinchMaxRef.current - 0.02
      const dynamicRange = Math.max(0.1, dynamicMax - dynamicMin)
      const mappedPinch = (normalizedPinch - dynamicMin) / dynamicRange
      const clampedPinch = Math.max(0, Math.min(1, mappedPinch))
      const curvedPinch = Math.pow(clampedPinch, 0.8)
      const pinchMix = curvedPinch >= 0.85 ? 1 : curvedPinch <= 0.06 ? 0 : curvedPinch
      setSingleHandPinchMix(pinchMix)
      setSingleHandFistForward(singleShape.isFistForward)
      setSingleHandRotation(handRotationAmount(singleHand as LandmarkPoint[]))
      setSingleHandForwardTilt(handForwardTiltAmount(singleHand as LandmarkPoint[]))
    } else {
      setSingleHandPinchMix(0)
      setSingleHandFistForward(false)
      setSingleHandRotation(0)
      setSingleHandForwardTilt(0)
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
    setIsOpenPalmForward(false)
    setIsFistForward(false)
    setIsFistSide(false)
    setIsFistSideLeft(false)
    setIsFistSideRight(false)
    setLeftHandFistForward(false)
    setRightHandClosedFist(false)
    setSingleHandFistForward(false)
    setLeftHandRotation(0)
    setSingleHandRotation(0)
    setLeftHandForwardTilt(0)
    setSingleHandForwardTilt(0)
    stableGestureRef.current = 'none'
    gestureCandidateRef.current = 'none'
    candidateFramesRef.current = 0
    lastGestureStatusRef.current = ''
    singleHandPinchMinRef.current = 0.25
    singleHandPinchMaxRef.current = 0.85
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
    isOpenPalmForward,
    isFistForward,
    isFistSide,
    isFistSideLeft,
    isFistSideRight,
    leftHandFistForward,
    rightHandClosedFist,
    singleHandFistForward,
    leftHandRotation,
    singleHandRotation,
    leftHandForwardTilt,
    singleHandForwardTilt,
  }
}
