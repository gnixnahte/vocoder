import { useCallback, useEffect, useRef, useState } from 'react'

type UseMicMonitorArgs = {
  setStatus: (value: string) => void
}

export function useMicMonitor({ setStatus }: UseMicMonitorArgs) {
  const audioContextRef = useRef<AudioContext | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const micGainRef = useRef<GainNode | null>(null)
  const smoothedMonitorLevelRef = useRef(1)

  const [micOn, setMicOn] = useState(false)
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([])
  const [selectedAudioInputId, setSelectedAudioInputId] = useState('')
  const hasSeenInitialDeviceSelectionRef = useRef(false)

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
      smoothedMonitorLevelRef.current = 0
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
      smoothedMonitorLevelRef.current = 1
      setMicOn(true)
      await refreshAudioInputs()
      setStatus('Mic on (monitoring live audio)')
      fadeMicGain(1)
    } catch (error) {
      setStatus(`Mic error: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  const toggleMic = () => {
    if (micOn) {
      stopMic()
      return
    }
    void startMic(selectedAudioInputId)
  }

  const setMonitorLevel = useCallback((level: number) => {
    const audioContext = audioContextRef.current
    const gainNode = micGainRef.current
    if (!audioContext || !gainNode) return

    const clampedLevel = Math.max(0, Math.min(1, level))
    const smoothedLevel =
      smoothedMonitorLevelRef.current + 0.18 * (clampedLevel - smoothedMonitorLevelRef.current)
    smoothedMonitorLevelRef.current = smoothedLevel
    gainNode.gain.setTargetAtTime(smoothedLevel, audioContext.currentTime, 0.03)
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
    if (!hasSeenInitialDeviceSelectionRef.current) {
      hasSeenInitialDeviceSelectionRef.current = true
      return
    }
    if (!micOn) return
    setStatus('Switching mic input...')
    stopMic()
    window.setTimeout(() => {
      void startMic(selectedAudioInputId)
    }, 60)
  }, [selectedAudioInputId])

  useEffect(() => {
    return () => {
      stopMic()
      void audioContextRef.current?.close()
      audioContextRef.current = null
    }
  }, [])

  return {
    micOn,
    audioInputs,
    selectedAudioInputId,
    setSelectedAudioInputId,
    toggleMic,
    setMonitorLevel,
  }
}
