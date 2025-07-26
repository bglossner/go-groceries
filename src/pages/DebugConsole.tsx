import React, { useEffect, useState } from 'react'

export const DebugConsole = () => {
  const [logs, setLogs] = useState<string[]>([])

  useEffect(() => {
    const origLog = console.log
    console.log = (...args) => {
      setLogs(prev => [...prev, args.map(String).join(' ')].slice(-10))
      origLog(...args)
    }

    const origError = console.error
    console.error = (...args) => {
      setLogs(prev => [...prev, args.map(String).join(' ')].slice(-10))
      origError(...args)
    }

    return () => {
      console.log = origLog
      console.error = origError
    }
  }, [])

  return (
    <div style={{
      background: 'rgba(0,0,0,0.7)',
      color: '#0f0',
      fontSize: '12px',
      maxHeight: '120px',
      overflowY: 'auto',
      zIndex: 9999,
      padding: '4px 8px'
    }}>
      {logs.map((log, idx) => <div key={idx}>{log}</div>)}
    </div>
  )
}