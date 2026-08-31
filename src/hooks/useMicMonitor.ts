import { useCallback, useEffect, useRef, useState } from 'react'

type UseMicMonitorArgs = {
  setStatus: (value: string) => void
}

const DEFAULT_TREMOLO_RATE_HZ = 8.5
const TREMOLO_INTENSITY = 0.45
const TREMOLO_DEPTH_SMOOTHING = 0.18
const TREMOLO_RATE_SMOOTHING = 0.14
const TREMOLO_DEPTH_TIME_CONSTANT = 0.12
const TREMOLO_RATE_TIME_CONSTANT = 0.18
const MIN_TREMOLO_RATE_HZ = 2.5
const MAX_TREMOLO_RATE_HZ = 13
const VOCODER_RING_HZ = 58

const createSoftFuzzCurve = (amount = 1.35) => {
  const samples = 44100
  const curve = new Float32Array(samples)
  const drive = amount * 8

  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / samples - 1
    curve[i] = Math.tanh(x * drive) * 0.72
  }

  return curve
}

export function useMicMonitor({ setStatus }: UseMicMonitorArgs) {
  const audioContextRef = useRef<AudioContext | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const dryGainRef = useRef<GainNode | null>(null)
  const wetGainRef = useRef<GainNode | null>(null)
  const convolverRef = useRef<ConvolverNode | null>(null)
  const micGainRef = useRef<GainNode | null>(null)
  const tremoloGainRef = useRef<GainNode | null>(null)
  const tremoloDepthGainRef = useRef<GainNode | null>(null)
  const tremoloOscillatorRef = useRef<OscillatorNode | null>(null)
  const vocoderDryGainRef = useRef<GainNode | null>(null)
  const vocoderWetGainRef = useRef<GainNode | null>(null)
  const vocoderRingModGainRef = useRef<GainNode | null>(null)
  const vocoderRingDepthGainRef = useRef<GainNode | null>(null)
  const vocoderRingOscillatorRef = useRef<OscillatorNode | null>(null)
  const monitorDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const smoothedMonitorLevelRef = useRef(0)
  const smoothedTremoloDepthRef = useRef(0)
  const smoothedTremoloRateRef = useRef(DEFAULT_TREMOLO_RATE_HZ)
  const micOnRef = useRef(false)
  const micStartGenerationRef = useRef(0)
  const stopMicTimerRef = useRef<number | null>(null)
  const restartMicTimerRef = useRef<number | null>(null)
  const pendingMicRestartRef = useRef(false)

  const [micOn, setMicOn] = useState(false)
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([])
  const [selectedAudioInputId, setSelectedAudioInputId] = useState('')
  const hasSeenInitialDeviceSelectionRef = useRef(false)

  const getAudioContext = useCallback(() => {
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
  }, [])

  const createImpulseResponse = useCallback((
    audioContext: AudioContext,
    seconds: number = 3.8,
    decay: number = 1.9,
  ) => {
    const length = Math.floor(audioContext.sampleRate * seconds)
    const impulse = audioContext.createBuffer(2, length, audioContext.sampleRate)
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel)
      for (let i = 0; i < length; i += 1) {
        const t = i / length
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay)
      }
    }
    return impulse
  }, [])

  const fadeMicGain = useCallback((targetValue: number) => {
    const audioContext = audioContextRef.current
    const gainNode = micGainRef.current
    if (!audioContext || !gainNode) return
    const now = audioContext.currentTime
    gainNode.gain.cancelScheduledValues(now)
    gainNode.gain.setValueAtTime(gainNode.gain.value, now)
    gainNode.gain.linearRampToValueAtTime(targetValue, now + 0.03)
  }, [])

  const releaseMicResources = useCallback(() => {
    micSourceRef.current?.disconnect()
    dryGainRef.current?.disconnect()
    wetGainRef.current?.disconnect()
    convolverRef.current?.disconnect()
    micGainRef.current?.disconnect()
    tremoloGainRef.current?.disconnect()
    tremoloDepthGainRef.current?.disconnect()
    tremoloOscillatorRef.current?.disconnect()
    tremoloOscillatorRef.current?.stop()
    vocoderDryGainRef.current?.disconnect()
    vocoderWetGainRef.current?.disconnect()
    vocoderRingModGainRef.current?.disconnect()
    vocoderRingDepthGainRef.current?.disconnect()
    vocoderRingOscillatorRef.current?.disconnect()
    vocoderRingOscillatorRef.current?.stop()
    monitorDestinationRef.current?.disconnect()
    micStreamRef.current?.getTracks().forEach((track) => track.stop())
    micSourceRef.current = null
    dryGainRef.current = null
    wetGainRef.current = null
    convolverRef.current = null
    micGainRef.current = null
    tremoloGainRef.current = null
    tremoloDepthGainRef.current = null
    tremoloOscillatorRef.current = null
    vocoderDryGainRef.current = null
    vocoderWetGainRef.current = null
    vocoderRingModGainRef.current = null
    vocoderRingDepthGainRef.current = null
    vocoderRingOscillatorRef.current = null
    monitorDestinationRef.current = null
    micStreamRef.current = null
    smoothedMonitorLevelRef.current = 0
    smoothedTremoloDepthRef.current = 0
    smoothedTremoloRateRef.current = DEFAULT_TREMOLO_RATE_HZ
  }, [])

  const stopMic = useCallback((cancelPendingRestart = true) => {
    micStartGenerationRef.current += 1
    micOnRef.current = false
    if (cancelPendingRestart) {
      pendingMicRestartRef.current = false
      if (restartMicTimerRef.current !== null) {
        window.clearTimeout(restartMicTimerRef.current)
        restartMicTimerRef.current = null
      }
    }
    fadeMicGain(0)
    if (stopMicTimerRef.current !== null) return

    stopMicTimerRef.current = window.setTimeout(() => {
      stopMicTimerRef.current = null
      releaseMicResources()
      setMicOn(false)
      setStatus('Mic off')
    }, 50)
  }, [fadeMicGain, releaseMicResources, setStatus])

  const refreshAudioInputs = useCallback(async () => {
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
  }, [setStatus])

  const startMic = useCallback(async (deviceId?: string) => {
    const startGeneration = micStartGenerationRef.current + 1
    micStartGenerationRef.current = startGeneration
    pendingMicRestartRef.current = false
    if (restartMicTimerRef.current !== null) {
      window.clearTimeout(restartMicTimerRef.current)
      restartMicTimerRef.current = null
    }
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
      if (startGeneration !== micStartGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const source = audioContext.createMediaStreamSource(stream)
      const dryGainNode = audioContext.createGain()
      const wetGainNode = audioContext.createGain()
      const wetBoostNode = audioContext.createGain()
      const convolverNode = audioContext.createConvolver()
      const gainNode = audioContext.createGain()
      const tremoloGainNode = audioContext.createGain()
      const tremoloDepthGainNode = audioContext.createGain()
      const tremoloOscillatorNode = audioContext.createOscillator()
      const vocoderDryGainNode = audioContext.createGain()
      const vocoderWetGainNode = audioContext.createGain()
      const vocoderHighpassNode = audioContext.createBiquadFilter()
      const vocoderRingModGainNode = audioContext.createGain()
      const vocoderRingDepthGainNode = audioContext.createGain()
      const vocoderRingOscillatorNode = audioContext.createOscillator()
      const vocoderBandpassNode = audioContext.createBiquadFilter()
      const vocoderFuzzNode = audioContext.createWaveShaper()
      const vocoderWarmthNode = audioContext.createBiquadFilter()
      const vocoderCompressorNode = audioContext.createDynamicsCompressor()
      const monitorDestination = audioContext.createMediaStreamDestination()

      convolverNode.buffer = createImpulseResponse(audioContext)
      dryGainNode.gain.value = 0.7
      wetGainNode.gain.value = 0.3
      wetBoostNode.gain.value = 1.8
      gainNode.gain.value = 0
      tremoloGainNode.gain.value = 1
      tremoloDepthGainNode.gain.value = 0
      tremoloOscillatorNode.frequency.value = DEFAULT_TREMOLO_RATE_HZ
      vocoderDryGainNode.gain.value = 1
      vocoderWetGainNode.gain.value = 0
      vocoderHighpassNode.type = 'highpass'
      vocoderHighpassNode.frequency.value = 75
      vocoderHighpassNode.Q.value = 0.35
      vocoderRingModGainNode.gain.value = 0
      vocoderRingDepthGainNode.gain.value = 0.24
      vocoderRingOscillatorNode.type = 'sine'
      vocoderRingOscillatorNode.frequency.value = VOCODER_RING_HZ
      vocoderBandpassNode.type = 'bandpass'
      vocoderBandpassNode.frequency.value = 720
      vocoderBandpassNode.Q.value = 0.5
      vocoderFuzzNode.curve = createSoftFuzzCurve()
      vocoderFuzzNode.oversample = '4x'
      vocoderWarmthNode.type = 'lowpass'
      vocoderWarmthNode.frequency.value = 2400
      vocoderWarmthNode.Q.value = 0.65
      vocoderCompressorNode.threshold.value = -26
      vocoderCompressorNode.knee.value = 24
      vocoderCompressorNode.ratio.value = 3
      vocoderCompressorNode.attack.value = 0.025
      vocoderCompressorNode.release.value = 0.22

      source.connect(dryGainNode)
      dryGainNode.connect(gainNode)

      source.connect(convolverNode)
      convolverNode.connect(wetGainNode)
      wetGainNode.connect(wetBoostNode)
      wetBoostNode.connect(gainNode)

      gainNode.connect(tremoloGainNode)
      tremoloOscillatorNode.connect(tremoloDepthGainNode)
      tremoloDepthGainNode.connect(tremoloGainNode.gain)
      tremoloGainNode.connect(vocoderDryGainNode)
      tremoloGainNode.connect(vocoderHighpassNode)
      vocoderHighpassNode.connect(vocoderRingModGainNode)
      vocoderRingOscillatorNode.connect(vocoderRingDepthGainNode)
      vocoderRingDepthGainNode.connect(vocoderRingModGainNode.gain)
      vocoderRingModGainNode.connect(vocoderBandpassNode)
      vocoderBandpassNode.connect(vocoderFuzzNode)
      vocoderFuzzNode.connect(vocoderWarmthNode)
      vocoderWarmthNode.connect(vocoderCompressorNode)
      vocoderCompressorNode.connect(vocoderWetGainNode)
      vocoderDryGainNode.connect(audioContext.destination)
      vocoderDryGainNode.connect(monitorDestination)
      vocoderWetGainNode.connect(audioContext.destination)
      vocoderWetGainNode.connect(monitorDestination)
      tremoloOscillatorNode.start()
      vocoderRingOscillatorNode.start()

      micStreamRef.current = stream
      micSourceRef.current = source
      dryGainRef.current = dryGainNode
      wetGainRef.current = wetGainNode
      convolverRef.current = convolverNode
      micGainRef.current = gainNode
      tremoloGainRef.current = tremoloGainNode
      tremoloDepthGainRef.current = tremoloDepthGainNode
      tremoloOscillatorRef.current = tremoloOscillatorNode
      vocoderDryGainRef.current = vocoderDryGainNode
      vocoderWetGainRef.current = vocoderWetGainNode
      vocoderRingModGainRef.current = vocoderRingModGainNode
      vocoderRingDepthGainRef.current = vocoderRingDepthGainNode
      vocoderRingOscillatorRef.current = vocoderRingOscillatorNode
      monitorDestinationRef.current = monitorDestination
      smoothedMonitorLevelRef.current = 0
      smoothedTremoloDepthRef.current = 0
      smoothedTremoloRateRef.current = DEFAULT_TREMOLO_RATE_HZ
      micOnRef.current = true
      setMicOn(true)
      await refreshAudioInputs()
      setStatus('Mic on (monitoring live audio)')
      fadeMicGain(0)
    } catch (error) {
      if (startGeneration !== micStartGenerationRef.current) return
      micOnRef.current = false
      setMicOn(false)
      setStatus(`Mic error: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }, [createImpulseResponse, fadeMicGain, getAudioContext, refreshAudioInputs, setStatus])

  const toggleMic = useCallback(() => {
    if (
      micOnRef.current
      || pendingMicRestartRef.current
      || stopMicTimerRef.current !== null
    ) {
      stopMic()
      return
    }
    void startMic(selectedAudioInputId)
  }, [selectedAudioInputId, startMic, stopMic])

  const setMonitorLevel = useCallback((level: number) => {
    const audioContext = audioContextRef.current
    const gainNode = micGainRef.current
    if (!audioContext || !gainNode) return

    const clampedLevel = Math.max(0, Math.min(2, level))
    const smoothedLevel =
      smoothedMonitorLevelRef.current + 0.35 * (clampedLevel - smoothedMonitorLevelRef.current)
    smoothedMonitorLevelRef.current = smoothedLevel
    gainNode.gain.setTargetAtTime(smoothedLevel, audioContext.currentTime, 0.03)
  }, [])

  const setReverbMix = useCallback((mix: number) => {
    const audioContext = audioContextRef.current
    const dryGainNode = dryGainRef.current
    const wetGainNode = wetGainRef.current
    if (!audioContext || !dryGainNode || !wetGainNode) return

    const clampedMix = Math.max(0, Math.min(1, mix))
    const now = audioContext.currentTime
    dryGainNode.gain.setTargetAtTime(1 - clampedMix, now, 0.03)
    wetGainNode.gain.setTargetAtTime(clampedMix, now, 0.03)
  }, [])

  const setTremoloDepth = useCallback((depth: number) => {
    const audioContext = audioContextRef.current
    const tremoloGainNode = tremoloGainRef.current
    const tremoloDepthGainNode = tremoloDepthGainRef.current
    if (!audioContext || !tremoloGainNode || !tremoloDepthGainNode) return

    const clampedDepth = Math.max(0, Math.min(1, depth))
    const smoothedDepth =
      smoothedTremoloDepthRef.current
      + TREMOLO_DEPTH_SMOOTHING * (clampedDepth - smoothedTremoloDepthRef.current)
    smoothedTremoloDepthRef.current = smoothedDepth
    const now = audioContext.currentTime
    tremoloGainNode.gain.setTargetAtTime(
      1 - smoothedDepth * TREMOLO_INTENSITY,
      now,
      TREMOLO_DEPTH_TIME_CONSTANT,
    )
    tremoloDepthGainNode.gain.setTargetAtTime(
      smoothedDepth * TREMOLO_INTENSITY,
      now,
      TREMOLO_DEPTH_TIME_CONSTANT,
    )
  }, [])

  const setTremoloRate = useCallback((rateHz: number) => {
    const audioContext = audioContextRef.current
    const tremoloOscillatorNode = tremoloOscillatorRef.current
    if (!audioContext || !tremoloOscillatorNode) return

    const clampedRate = Math.max(MIN_TREMOLO_RATE_HZ, Math.min(MAX_TREMOLO_RATE_HZ, rateHz))
    const smoothedRate =
      smoothedTremoloRateRef.current
      + TREMOLO_RATE_SMOOTHING * (clampedRate - smoothedTremoloRateRef.current)
    smoothedTremoloRateRef.current = smoothedRate
    tremoloOscillatorNode.frequency.setTargetAtTime(
      smoothedRate,
      audioContext.currentTime,
      TREMOLO_RATE_TIME_CONSTANT,
    )
  }, [])

  const setVocoderEnabled = useCallback((enabled: boolean) => {
    const audioContext = audioContextRef.current
    const vocoderDryGainNode = vocoderDryGainRef.current
    const vocoderWetGainNode = vocoderWetGainRef.current
    const vocoderRingModGainNode = vocoderRingModGainRef.current
    if (!audioContext || !vocoderDryGainNode || !vocoderWetGainNode || !vocoderRingModGainNode) {
      return
    }

    const now = audioContext.currentTime
    if (enabled) {
      vocoderDryGainNode.gain.setTargetAtTime(0.34, now, 0.08)
      vocoderWetGainNode.gain.setTargetAtTime(0.72, now, 0.08)
      vocoderRingModGainNode.gain.setTargetAtTime(0.82, now, 0.08)
    } else {
      vocoderDryGainNode.gain.setTargetAtTime(1, now, 0.05)
      vocoderWetGainNode.gain.setTargetAtTime(0, now, 0.05)
      vocoderRingModGainNode.gain.setTargetAtTime(0, now, 0.05)
    }
  }, [])

  useEffect(() => {
    const initialRefreshTimer = window.setTimeout(() => {
      void refreshAudioInputs()
    }, 0)
    const mediaDevices = navigator.mediaDevices
    if (!mediaDevices) {
      return () => window.clearTimeout(initialRefreshTimer)
    }

    const handleDeviceChange = () => {
      void refreshAudioInputs()
    }

    mediaDevices.addEventListener('devicechange', handleDeviceChange)

    return () => {
      window.clearTimeout(initialRefreshTimer)
      mediaDevices.removeEventListener('devicechange', handleDeviceChange)
    }
  }, [refreshAudioInputs])

  useEffect(() => {
    if (!hasSeenInitialDeviceSelectionRef.current) {
      hasSeenInitialDeviceSelectionRef.current = true
      return
    }
    if (!micOnRef.current && !pendingMicRestartRef.current) return
    pendingMicRestartRef.current = true
    if (restartMicTimerRef.current !== null) {
      window.clearTimeout(restartMicTimerRef.current)
    }
    setStatus('Switching mic input...')
    if (micOnRef.current) stopMic(false)
    restartMicTimerRef.current = window.setTimeout(() => {
      restartMicTimerRef.current = null
      pendingMicRestartRef.current = false
      void startMic(selectedAudioInputId)
    }, 60)

    return () => {
      if (restartMicTimerRef.current !== null) {
        window.clearTimeout(restartMicTimerRef.current)
        restartMicTimerRef.current = null
      }
    }
  }, [selectedAudioInputId, setStatus, startMic, stopMic])

  useEffect(() => {
    return () => {
      micStartGenerationRef.current += 1
      pendingMicRestartRef.current = false
      if (stopMicTimerRef.current !== null) {
        window.clearTimeout(stopMicTimerRef.current)
        stopMicTimerRef.current = null
      }
      if (restartMicTimerRef.current !== null) {
        window.clearTimeout(restartMicTimerRef.current)
        restartMicTimerRef.current = null
      }
      releaseMicResources()
      void audioContextRef.current?.close()
      audioContextRef.current = null
    }
  }, [releaseMicResources])

  return {
    micOn,
    audioInputs,
    selectedAudioInputId,
    setSelectedAudioInputId,
    toggleMic,
    setMonitorLevel,
    setReverbMix,
    setTremoloDepth,
    setTremoloRate,
    setVocoderEnabled,
    getMicStream: () => micStreamRef.current,
    getMonitorStream: () => monitorDestinationRef.current?.stream ?? null,
  }
}
