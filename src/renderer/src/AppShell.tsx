function AppShell() {
  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif',
        color: '#1a1a1a',
        backgroundColor: '#fafafa'
      }}
    >
      <h1 style={{ fontSize: '2rem', fontWeight: 600, margin: 0 }}>LedgerPage</h1>
      <p style={{ color: '#666', marginTop: '0.5rem' }}>Slice 1 — application shell</p>
    </main>
  )
}

export default AppShell
