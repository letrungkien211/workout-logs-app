import { useEffect, useMemo, useState } from 'react'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { collection, deleteDoc, doc, onSnapshot, setDoc, writeBatch } from 'firebase/firestore'
import { auth, db } from './firebase'
import { exerciseCatalog, type Exercise } from './exerciseCatalog'
import './App.css'

type Item = { exerciseId: string; sets: number; reps: number; weight: number }
type Workout = { id: string; name: string; days: string[]; day?: string; items: Item[] }
type Log = { id: string; workout: string; date: string; items: Item[]; restDay?: boolean; workoutId?: string }
type RestDay = { id: string; day: string }
type Modal = 'exercise' | 'workout' | 'workout-edit' | 'manual' | 'import' | 'log' | null

const uid = () => Math.random().toString(36).slice(2, 10)
const todayName = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(new Date())
const weekDays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted && char === '"' && text[i + 1] === '"') { field += '"'; i++ }
    else if (char === '"') quoted = !quoted
    else if (!quoted && char === ',') { row.push(field.trim()); field = '' }
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field.trim()); field = ''
      if (row.some(value => value !== '')) rows.push(row)
      row = []
    } else field += char
  }
  row.push(field.trim())
  if (row.some(value => value !== '')) rows.push(row)
  return rows
}

function App() {
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [restDays, setRestDays] = useState<RestDay[]>([])
  const [tab, setTab] = useState('Today')
  const [modal, setModal] = useState<Modal>(null)
  const [editing, setEditing] = useState<Log | null>(null)
  const [editingWorkout, setEditingWorkout] = useState<Workout | null>(null)
  const [importLogs, setImportLogs] = useState<Log[]>([])
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importFileName, setImportFileName] = useState('')
  const [selected, setSelected] = useState('all')
  const [page, setPage] = useState(1)
  const [exerciseName, setExerciseName] = useState('')
  const [loadType, setLoadType] = useState<Exercise['load']>('absolute')
  const [unit, setUnit] = useState<Exercise['unit']>('reps')
  const [workoutName, setWorkoutName] = useState('')
  const [workoutDays, setWorkoutDays] = useState<string[]>([todayName])
  const [workoutItems, setWorkoutItems] = useState<Item[]>([{ exerciseId: 'e1', sets: 3, reps: 10, weight: 0 }])
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [dataReady, setDataReady] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const allExercises = [...exerciseCatalog, ...exercises]

  useEffect(() => onAuthStateChanged(auth, nextUser => { setUser(nextUser); setAuthReady(true) }), [])
  useEffect(() => {
    if (!user) { setExercises([]); setWorkouts([]); setLogs([]); setRestDays([]); setDataReady(false); return }
    setDataReady(false)
    const base = `users/${user.uid}`
    const fail = () => { setAuthError('Could not read your workout data. Check that Firestore is enabled and its security rules are deployed.'); setDataReady(true) }
    const unsubs = [
      onSnapshot(collection(db, `${base}/exercises`), snap => { setExercises(snap.docs.map(d => d.data() as Exercise)); setDataReady(true) }, fail),
      onSnapshot(collection(db, `${base}/workouts`), snap => { setWorkouts(snap.docs.map(d => { const data = d.data() as Workout; return { ...data, days: data.days ?? (data.day ? [data.day] : []) } })); setDataReady(true) }, fail),
      onSnapshot(collection(db, `${base}/logs`), snap => { setLogs(snap.docs.map(d => d.data() as Log)); setDataReady(true) }, fail),
      onSnapshot(collection(db, `${base}/restDays`), snap => { setRestDays(snap.docs.map(d => d.data() as RestDay)); setDataReady(true) }, fail),
    ]
    return () => unsubs.forEach(unsub => unsub())
  }, [user])
  const saveRecord = async <T extends { id: string }>(kind: 'exercises' | 'workouts' | 'logs' | 'restDays', value: T) => {
    if (!user) return
    try { await setDoc(doc(db, 'users', user.uid, kind, value.id), value) }
    catch { setAuthError('Could not save your changes. Check your connection and Firestore security rules.') }
  }
  const removeRecord = async (kind: 'exercises' | 'workouts' | 'logs' | 'restDays', id: string) => {
    if (!user) return
    try { await deleteDoc(doc(db, 'users', user.uid, kind, id)) }
    catch { setAuthError('Could not delete this record. Check your connection and Firestore security rules.') }
  }
  const handleAuth = async () => {
    setAuthError('')
    setAuthBusy(true)
    try {
      if (user) await signOut(auth)
      else await signInWithPopup(auth, new GoogleAuthProvider())
    } catch (error) {
      const code = (error as { code?: string }).code
      setAuthError(code === 'auth/unauthorized-domain' ? 'Add this site’s domain to Firebase Authentication → Settings → Authorized domains.' : code === 'auth/popup-closed-by-user' ? '' : 'Google sign-in could not be completed. Please try again.')
    } finally { setAuthBusy(false) }
  }
  const exercise = (id: string) => allExercises.find(e => e.id === id)
  const todayRestDay = restDays.some(r => r.day === todayName)
  const todayRestCompleted = logs.some(l => l.restDay && new Date(l.date).toDateString() === new Date().toDateString())
  const todayWorkouts = workouts.filter(w => w.days.includes(todayName))
  const isWorkoutDone = (workout: Workout) => logs.some(log => (log.workoutId === workout.id || (!log.workoutId && log.workout === workout.name)) && new Date(log.date).toDateString() === new Date().toDateString())
  const filtered = useMemo(() => logs.filter(l => selected === 'all' || l.items.some(i => i.exerciseId === selected)), [logs, selected])
  const paged = filtered.slice((page - 1) * 20, page * 20)
  const recent = [...logs].sort((a, b) => +new Date(b.date) - +new Date(a.date)).slice(0, 3)
  const openWorkout = (day?: string) => { setEditingWorkout(null); setWorkoutName(''); setWorkoutDays(day ? [day] : [todayName]); setWorkoutItems([{ exerciseId: allExercises[0]?.id ?? '', sets: 3, reps: 10, weight: 0 }]); setModal('workout') }
  const openEditWorkout = (workout: Workout) => { setEditingWorkout(workout); setWorkoutName(workout.name); setWorkoutDays(workout.days); setWorkoutItems(workout.items.map(item => ({ ...item }))); setModal('workout-edit') }
  const openManualLog = () => { setWorkoutName(''); setWorkoutItems([{ exerciseId: allExercises[0]?.id ?? '', sets: 3, reps: 10, weight: 0 }]); setModal('manual') }
  const openImport = () => { setImportLogs([]); setImportErrors([]); setImportFileName(''); setModal('import') }
  const downloadCsvTemplate = () => {
    const url = URL.createObjectURL(new Blob(['date,workout,exercise,sets,reps,weight\n'], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'workout-log-template.csv'; anchor.click(); URL.revokeObjectURL(url)
  }
  const readImportFile = async (file?: File) => {
    if (!file) return
    setImportFileName(file.name); setImportLogs([]); setImportErrors([])
    if (!file.name.toLowerCase().endsWith('.csv')) { setImportErrors(['Please choose a CSV file.']); return }
    const rows = parseCsvRows((await file.text()).replace(/^\uFEFF/, ''))
    if (rows.length < 2) { setImportErrors(['The CSV needs a header row and at least one workout row.']); return }
    const headers = rows[0].map(value => value.toLowerCase().replace(/[\s-]+/g, '_'))
    const column = (...names: string[]) => headers.findIndex(header => names.includes(header))
    const dateIndex = column('date', 'workout_date')
    const workoutIndex = column('workout', 'workout_name', 'session')
    const exerciseIndex = column('exercise', 'exercise_name', 'movement')
    const setsIndex = column('sets', 'set_count')
    const repsIndex = column('reps', 'seconds', 'duration')
    const weightIndex = column('weight', 'weight_kg', 'load')
    const errors: string[] = []
    if (dateIndex < 0 || workoutIndex < 0 || exerciseIndex < 0 || setsIndex < 0 || repsIndex < 0) {
      setImportErrors(['Required columns: date, workout, exercise, sets, reps. The weight column is optional.'])
      return
    }
    const exercisesByName = new Map(allExercises.map(item => [item.name.trim().toLowerCase(), item]))
    const groups = new Map<string, Log>()
    rows.slice(1).forEach((row, index) => {
      const line = index + 2
      const dateText = row[dateIndex] ?? ''
      const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(dateText) ? `${dateText}T12:00:00` : dateText)
      const workout = row[workoutIndex] ?? ''
      const exerciseName = row[exerciseIndex] ?? ''
      const exerciseItem = exercisesByName.get(exerciseName.toLowerCase())
      const sets = Number(row[setsIndex])
      const reps = Number(row[repsIndex])
      const weightText = weightIndex < 0 ? '' : row[weightIndex] ?? ''
      const weight = weightText === '' ? 0 : Number(weightText)
      if (!dateText || Number.isNaN(date.getTime())) errors.push(`Row ${line}: invalid date “${dateText}”. Use YYYY-MM-DD.`)
      if (!workout) errors.push(`Row ${line}: workout name is required.`)
      if (!exerciseItem) errors.push(`Row ${line}: “${exerciseName || '(blank)'}” isn’t in your exercise library.`)
      if (!Number.isInteger(sets) || sets < 1) errors.push(`Row ${line}: sets must be a positive whole number.`)
      if (!Number.isFinite(reps) || reps < 1) errors.push(`Row ${line}: reps or seconds must be a positive number.`)
      if (!Number.isFinite(weight) || weight < 0) errors.push(`Row ${line}: weight must be zero or greater.`)
      if (!dateText || Number.isNaN(date.getTime()) || !workout || !exerciseItem || !Number.isInteger(sets) || sets < 1 || !Number.isFinite(reps) || reps < 1 || !Number.isFinite(weight) || weight < 0) return
      const dateIso = date.toISOString()
      const key = `${date.toDateString()}::${workout.toLowerCase()}`
      const log = groups.get(key) ?? { id: uid(), workout, date: dateIso, items: [] }
      log.items.push({ exerciseId: exerciseItem.id, sets, reps, weight })
      groups.set(key, log)
    })
    setImportLogs([...groups.values()]); setImportErrors(errors)
    if (!errors.length && !groups.size) setImportErrors(['No workout rows were found in this CSV.'])
  }
  const saveImportedLogs = async () => {
    if (!user || importErrors.length || !importLogs.length) return
    try {
      for (let start = 0; start < importLogs.length; start += 450) {
        const batch = writeBatch(db)
        importLogs.slice(start, start + 450).forEach(log => batch.set(doc(db, 'users', user.uid, 'logs', log.id), log))
        await batch.commit()
      }
      setLogs([...importLogs, ...logs]); setModal(null)
    } catch { setAuthError('Some imported workouts could not be saved. Check your connection and Firestore security rules.') }
  }
  const moveWorkoutItem = (index: number, offset: -1 | 1) => { const destination = index + offset; if (destination < 0 || destination >= workoutItems.length) return; const reordered = [...workoutItems]; [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]]; setWorkoutItems(reordered) }
  const saveWorkout = () => {
    if (!workoutName.trim() || !workoutItems.length) return
    const workout: Workout = editingWorkout ? { ...editingWorkout, name: workoutName.trim(), days: workoutDays, items: workoutItems } : { id: uid(), name: workoutName.trim(), days: workoutDays, items: workoutItems }
    setWorkouts(editingWorkout ? workouts.map(w => w.id === workout.id ? workout : w) : [...workouts, workout])
    void saveRecord('workouts', workout)
    const restPlansToRemove = restDays.filter(r => workoutDays.includes(r.day))
    if (restPlansToRemove.length) { setRestDays(restDays.filter(r => !workoutDays.includes(r.day))); restPlansToRemove.forEach(r => void removeRecord('restDays', r.id)) }
    setEditingWorkout(null)
    setModal(null)
  }
  const saveManualLog = () => { if (!workoutName.trim() || !workoutItems.length) return; const log: Log = { id: uid(), workout: workoutName.trim(), date: new Date().toISOString(), items: workoutItems.map(item => ({ ...item })) }; setLogs([log, ...logs]); void saveRecord('logs', log); setModal(null) }
  const toggleWorkoutDay = (workout: Workout, day: string) => { const assigning = !workout.days.includes(day); const updated = { ...workout, days: assigning ? [...workout.days, day] : workout.days.filter(d => d !== day) }; setWorkouts(workouts.map(w => w.id === workout.id ? updated : w)); void saveRecord('workouts', updated); if (assigning && restDays.some(r => r.day === day)) toggleRestDay(day) }
  const toggleRestDay = (day: string) => { const existing = restDays.find(r => r.day === day); if (existing) { setRestDays(restDays.filter(r => r.day !== day)); void removeRecord('restDays', existing.id) } else { const restDay = { id: day, day }; setRestDays([...restDays, restDay]); void saveRecord('restDays', restDay) } }
  const toggleRestCompletion = () => {
    const existing = logs.find(l => l.restDay && new Date(l.date).toDateString() === new Date().toDateString())
    if (existing) { setLogs(logs.filter(l => l.id !== existing.id)); void removeRecord('logs', existing.id) }
    else { const log: Log = { id: `rest-${new Date().toISOString().slice(0, 10)}`, workout: 'Rest day', date: new Date().toISOString(), items: [], restDay: true }; setLogs([log, ...logs]); void saveRecord('logs', log) }
  }
  const completeWorkout = (w: Workout) => { const existing = logs.find(log => (log.workoutId === w.id || (!log.workoutId && log.workout === w.name)) && new Date(log.date).toDateString() === new Date().toDateString()); if (existing) { setLogs(logs.filter(log => log.id !== existing.id)); void removeRecord('logs', existing.id) } else { const log: Log = { id: uid(), workoutId: w.id, workout: w.name, date: new Date().toISOString(), items: w.items.map(i => ({ ...i })) }; setLogs([log, ...logs]); void saveRecord('logs', log) } }
  const changeItem = (id: string, key: 'sets' | 'reps', amount: number) => { const changed = workouts.map(w => w.id === id ? { ...w, items: w.items.map(i => ({ ...i, [key]: Math.max(1, i[key] + amount) })) } : w); setWorkouts(changed); const updated = changed.find(w => w.id === id); if (updated) void saveRecord('workouts', updated) }
  const saveExercise = () => { if (!exerciseName.trim()) return; const created = { id: uid(), name: exerciseName.trim(), load: loadType, unit }; setExercises([...exercises, created]); void saveRecord('exercises', created); setExerciseName(''); setModal(null) }
  const openLog = (log: Log) => { setEditing(log); setModal('log') }
  const saveLog = () => { if (editing) { setLogs(logs.map(l => l.id === editing.id ? editing : l)); void saveRecord('logs', editing) }; setModal(null) }
  const deleteLog = (id: string) => { setLogs(logs.filter(l => l.id !== id)); void removeRecord('logs', id); setModal(null) }
  const updateLogItem = (index: number, key: keyof Item, value: number) => { if (!editing) return; const items = editing.items.map((item, i) => i === index ? { ...item, [key]: value } : item); setEditing({ ...editing, items }) }
  const fmt = (d: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(d))
  const itemSummary = (items: Item[]) => items.length ? items.map(i => exercise(i.exerciseId)?.name).filter(Boolean).join(' · ') : 'Rest day · recovery logged'

  if (!authReady) return <div className="auth-screen"><div className="auth-brand"><span className="brand-mark">W</span><span className="brand-name">Workout Log</span></div><div className="auth-panel"><span className="sparkle">✳</span><h1>Your training, all in one place.</h1><p>Sign in to open your private workout space.</p><div className="auth-loading">Checking sign-in…</div></div></div>
  if (!user) return <div className="auth-screen"><div className="auth-brand"><span className="brand-mark">W</span><span className="brand-name">Workout Log</span></div><div className="auth-panel"><span className="sparkle">✳</span><div className="eyebrow">A SPACE JUST FOR YOU</div><h1>Your training, all in one place.</h1><p>Sign in to open your private workout space. Your workouts are only available to your account.</p><button className="google-button" disabled={authBusy} onClick={handleAuth}><span className="google-g">G</span>{authBusy ? 'Connecting to Google…' : 'Continue with Google'}<span>→</span></button>{authError && <div className="auth-error">{authError}</div>}<div className="auth-private">🔒 &nbsp;Your account is required to view any workout data.</div></div></div>
  if (!dataReady) return <div className="auth-screen"><div className="auth-brand"><span className="brand-mark">W</span><span className="brand-name">Workout Log</span></div><div className="auth-panel"><div className="eyebrow">YOUR PRIVATE WORKSPACE</div><h1>Getting your space ready.</h1><p>Loading your workouts from Firestore…</p></div></div>

  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#" onClick={e => { e.preventDefault(); setTab('Today') }}><span className="brand-mark">W</span><span className="brand-name">Workout Log</span></a>
      <div className="side-label">WORKSPACE</div><nav>{[['Today', '◷'], ['Schedule', '▦'], ['Exercises', '⌁'], ['All logs', '☷']].map(([name, icon]) => <button key={name} className={`nav-link ${tab === name ? 'active' : ''}`} onClick={() => setTab(name)}><span className="nav-icon">{icon}</span>{name}{name === 'Today' && todayWorkouts.length > 0 && <span className="nav-count">{todayWorkouts.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="coach-note"><span className="sparkle">✳</span><strong>Small steps add up.</strong><p>Show up for yourself today.</p><div className="note-line" /></div><button className="user-profile" onClick={handleAuth} disabled={authBusy}><div className="avatar">{user?.photoURL ? <img src={user.photoURL} alt="" /> : user?.displayName?.charAt(0) ?? 'G'}</div><div><strong>{authBusy ? 'Connecting…' : user?.displayName ?? 'Google sign-in'}</strong><span>{user ? 'Sign out' : 'Sign in / create account'}</span></div>{user && <span className="profile-dots">↪</span>}</button>{authError && <div className="auth-error">{authError}</div>}</div>
    </aside>
    <main className="main-content"><header className="topbar"><div className="mobile-brand"><span className="brand-mark">W</span><span className="brand-name">Workout Log</span></div><div className="breadcrumb">Workspace <span>/</span> <b>{tab}</b></div><button className="mobile-signout" onClick={handleAuth}>Sign out</button></header>
      <div className="page-wrap">{authError && <div className="auth-banner">{authError}<button onClick={() => setAuthError('')}>×</button></div>}{tab === 'Today' && <>
        <div className="greeting-row"><div><div className="eyebrow">YOUR TRAINING, YOUR PACE</div><h1>Make today count<span className="title-period">.</span></h1><p className="date-line">{dateLabel}<span className="date-dot">·</span><span className="weather">A good day to move</span></p></div><div className="streak-card"><span className="streak-icon">✳</span><div><strong>{logs.length ? 'Keep your rhythm' : 'Start your rhythm'}</strong><span>{logs.length} sessions logged so far</span></div></div></div>
        <section className="today-section"><div className="section-heading"><div><div className="section-kicker">ON THE PLAN</div><h2>Today's workout</h2></div><div className="heading-actions"><button className="text-button" onClick={openManualLog}>＋ Log manually</button><button className="text-button" onClick={() => setTab('Schedule')}>View schedule <span>↗</span></button></div></div>
          {todayRestDay && <div className="rest-day-card"><div className="rest-day-symbol">☼</div><div><span className="workout-category">SCHEDULED REST DAY</span><strong>{todayRestCompleted ? 'Rest day complete' : 'Rest and recover'}</strong><p>{todayRestCompleted ? 'You made space to recover today.' : 'When you have taken your rest, check it off here.'}</p></div><label className="check-control"><input type="checkbox" checked={todayRestCompleted} onChange={toggleRestCompletion} aria-label="Mark rest day complete" /><span /></label></div>}{todayWorkouts.length ? <div className="workout-list">{todayWorkouts.map((w, wi) => <article className={`workout-card ${isWorkoutDone(w) ? 'completed' : ''}`} key={w.id}><div className="workout-top"><div className={`workout-symbol symbol-${wi % 3}`}>{wi === 0 ? '↗' : wi === 1 ? '⌁' : '✳'}</div><div className="workout-heading"><span className="workout-category">{w.items.length} EXERCISES <i>·</i> {w.items.reduce((n, i) => n + i.sets, 0)} SETS</span><h3>{w.name}</h3></div><label className="check-control"><input type="checkbox" checked={isWorkoutDone(w)} onChange={() => completeWorkout(w)} aria-label={`Complete ${w.name}`} /><span /></label></div><div className="workout-exercises">{w.items.map((i, idx) => { const e = exercise(i.exerciseId); return <div className="exercise-line" key={i.exerciseId + idx}><div className="exercise-info"><span className="exercise-bullet">{String(idx + 1).padStart(2, '0')}</span><span className="exercise-name">{e?.name ?? 'Exercise'}</span><span className="exercise-detail">{i.weight > 0 ? `${i.weight} kg · ` : ''}{e?.unit === 'seconds' ? `${i.reps}s` : `${i.reps} reps`}</span></div><div className="stepper"><button onClick={() => changeItem(w.id, 'reps', -1)} aria-label="Decrease reps">−</button><span>{i.sets} × {i.reps}</span><button onClick={() => changeItem(w.id, 'reps', 1)} aria-label="Increase reps">+</button></div></div> })}</div>{isWorkoutDone(w) && <div className="completed-note">✓ Workout logged. Nice work.</div>}</article>)}</div> : !todayRestDay && <div className="empty-state"><span>✳</span><strong>A little movement goes a long way.</strong><p>Nothing scheduled for today. Add a workout or check your schedule.</p><button className="button-primary" onClick={() => openWorkout()}>＋ Create workout</button></div>}
        </section>
        <section className="recent-section"><div className="section-heading"><div><div className="section-kicker">THE WORK YOU PUT IN</div><h2>Recent sessions</h2></div><button className="text-button" onClick={() => setTab('All logs')}>All logs <span>↗</span></button></div><div className="recent-list">{recent.length ? recent.map(log => <button className="recent-row" key={log.id} onClick={() => openLog(log)}><div className="recent-date"><strong>{fmt(log.date).split(' ')[1]}</strong><span>{fmt(log.date).split(' ')[0].toUpperCase()}</span></div><div className="recent-info"><strong>{log.workout}</strong><span>{itemSummary(log.items)}</span></div><span className="recent-volume">{log.restDay ? 'Recovery' : `${log.items.reduce((s, i) => s + i.sets, 0)} sets`}</span><span className="chevron">›</span></button>) : <div className="empty-small">Your completed workouts will show up here.</div>}</div></section>
        <div className="bottom-quote"><span>“</span><p>Consistency is a form of self-respect.</p><span className="quote-end">✳</span></div>
      </>}
      {tab === 'Schedule' && <><div className="page-intro"><div className="eyebrow">PLAN AHEAD</div><h1>Your schedule<span className="title-period">.</span></h1><p>Build a rhythm that works for you.</p><button className="button-primary" onClick={() => openWorkout()}>＋ Add workout</button></div><div className="schedule-grid">{weekDays.map(day => { const isRestDay = restDays.some(r => r.day === day); return <div className={`day-column ${isRestDay ? 'rest-day-column' : ''}`} key={day}><div className={`day-header ${day === todayName ? 'is-today' : ''}`}><span>{day}</span>{day === todayName && <i>Today</i>}</div>{isRestDay && <div className="rest-day-chip">☼ Planned rest day</div>}{workouts.filter(w => w.days.includes(day)).map(w => <article className="schedule-card" key={w.id}><span className="schedule-dot"/><strong>{w.name}</strong><span>{w.items.length} exercises</span><button aria-label={`Remove ${w.name} from ${day}`} onClick={() => toggleWorkoutDay(w, day)}>×</button></article>)}<button className={`rest-day-control ${isRestDay ? 'selected' : ''}`} onClick={() => toggleRestDay(day)}>{isRestDay ? '✓ Rest day planned' : '＋ Plan rest day'}</button><button className="add-to-day" onClick={() => openWorkout(day)}>＋ Add workout</button></div>})}</div><section className="schedule-library"><div className="section-heading"><div><div className="section-kicker">WORKOUT UNITS</div><h2>Your workouts</h2></div><button className="text-button" onClick={() => openWorkout()}>＋ Create workout</button></div>{workouts.length ? <div className="schedule-workout-list">{workouts.map((workout, index) => <article className="schedule-workout-row" key={workout.id}><span className={`library-icon library-${index % 3}`}>{['↗','⌁','✳'][index % 3]}</span><div className="schedule-workout-info"><strong>{workout.name}</strong><span>{workout.items.length} exercises · {workout.items.reduce((n, item) => n + item.sets, 0)} sets</span><div className="weekday-assignments">{weekDays.map(day => <button key={day} className={workout.days.includes(day) ? 'assigned' : ''} onClick={() => toggleWorkoutDay(workout, day)} aria-label={`${workout.days.includes(day) ? 'Remove' : 'Schedule'} ${workout.name} ${day}`}>{day}</button>)}</div></div><div className="schedule-workout-actions"><button className="edit-workout-button" onClick={() => openEditWorkout(workout)}>Edit</button><button className="delete-exercise" onClick={() => { setWorkouts(workouts.filter(w => w.id !== workout.id)); void removeRecord('workouts', workout.id) }} aria-label={`Delete workout ${workout.name}`}>×</button></div></article>)}</div> : <div className="empty-small">Create a workout here, then assign it to one or more weekdays.</div>}</section><div className="schedule-tip"><span>✳</span> Add workouts from a day card, or assign weekdays to a workout below.</div></>}
      {tab === 'Exercises' && <><div className="page-intro"><div className="eyebrow">YOUR MOVEMENT LIBRARY</div><h1>Exercises<span className="title-period">.</span></h1><p>Browse the shared catalog or add your own exercises.</p><button className="button-primary" onClick={() => setModal('exercise')}>＋ Add exercise</button></div><div className="library-list"><div className="exercise-group-title">SHARED CATALOG · {exerciseCatalog.length}</div>{exerciseCatalog.map((e, i) => <div className="library-row" key={e.id}><span className={`library-icon library-${i % 3}`}>{['↗','⌁','✳'][i % 3]}</span><div className="library-info"><strong>{e.name}</strong><span>{e.category} <i>·</i> {e.load === 'bodyweight' ? 'Bodyweight' : e.load === 'weighted' ? 'Bodyweight + weight' : 'Absolute weight'} <i>·</i> {e.unit === 'reps' ? 'Reps' : 'Seconds'}</span></div><span className="catalog-badge">SHARED</span></div>)}<div className="exercise-group-title personal-exercise-title">YOUR EXERCISES · {exercises.length}</div>{exercises.map((e, i) => <div className="library-row" key={e.id}><span className={`library-icon library-${i % 3}`}>{['↗','⌁','✳'][i % 3]}</span><div className="library-info"><strong>{e.name}</strong><span>{e.load === 'bodyweight' ? 'Bodyweight' : e.load === 'weighted' ? 'Bodyweight + weight' : 'Absolute weight'} <i>·</i> {e.unit === 'reps' ? 'Reps' : 'Seconds'}</span></div><button className="delete-exercise" onClick={() => { setExercises(exercises.filter(x => x.id !== e.id)); void removeRecord('exercises', e.id) }} aria-label={`Delete ${e.name}`}>×</button></div>)}</div></>}      {tab === 'All logs' && <><div className="page-intro log-intro"><div className="eyebrow">EVERY REP COUNTS</div><h1>Workout logs<span className="title-period">.</span></h1><p>A record of showing up for yourself.</p><button className="button-primary" onClick={() => openWorkout()}>＋ Log a workout</button></div><div className="log-toolbar"><label className="filter-label">FILTER BY EXERCISE<select value={selected} onChange={e => { setSelected(e.target.value); setPage(1) }}><option value="all">All exercises</option>{allExercises.map(e => <option value={e.id} key={e.id}>{e.name}</option>)}</select></label><div className="log-toolbar-actions"><span className="result-count">{filtered.length} {filtered.length === 1 ? 'session' : 'sessions'}</span><button className="text-button" onClick={openImport}>Import CSV</button></div></div><div className="all-logs">{paged.map(log => <button className="log-row" key={log.id} onClick={() => openLog(log)}><div className="log-date"><strong>{new Date(log.date).getDate()}</strong><span>{new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(new Date(log.date))}</span></div><div className="log-main"><strong>{log.workout}</strong><span>{itemSummary(log.items)}</span></div><span className="log-sets">{log.restDay ? 'Recovery' : `${log.items.reduce((s, i) => s + i.sets, 0)} sets`}</span><span className="chevron">›</span></button>)}</div>{!paged.length && <div className="empty-small">No sessions match this exercise yet.</div>}<div className="pagination"><span>Showing {filtered.length ? (page - 1) * 20 + 1 : 0}–{Math.min(page * 20, filtered.length)} of {filtered.length}</span><div><button disabled={page === 1} onClick={() => setPage(page - 1)}>←</button><span>{page} / {Math.max(1, Math.ceil(filtered.length / 20))}</span><button disabled={page >= Math.ceil(filtered.length / 20)} onClick={() => setPage(page + 1)}>→</button></div></div></>}
      </div>
      <nav className="mobile-nav">{[['Today','◷'],['Schedule','▦'],['Exercises','⌁'],['All logs','☷']].map(([name,icon])=><button key={name} className={tab===name?'active':''} onClick={()=>setTab(name)}><span>{icon}</span>{name}</button>)}</nav>
    </main>
    {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) { setModal(null); setEditingWorkout(null) } }}><div className="modal-card"><div className="modal-top"><div><div className="eyebrow">{modal === 'exercise' ? 'MOVEMENT LIBRARY' : modal === 'workout' ? 'MAKE A PLAN' : modal === 'workout-edit' ? 'WORKOUT UNIT' : modal === 'manual' ? 'LOG A SESSION' : modal === 'import' ? 'BATCH IMPORT' : editing?.restDay ? 'RECOVERY' : 'SESSION DETAILS'}</div><h2>{modal === 'exercise' ? 'Add an exercise' : modal === 'workout' ? 'Create a workout' : modal === 'workout-edit' ? 'Edit workout' : modal === 'manual' ? 'Log a workout' : modal === 'import' ? 'Import past workouts' : editing?.restDay ? 'Rest day check-in' : 'Edit session'}</h2></div><button className="modal-close" onClick={() => { setModal(null); setEditingWorkout(null) }}>×</button></div>
      {modal === 'exercise' && <div className="form-stack"><label>Exercise name<input autoFocus placeholder="e.g. Goblet squat" value={exerciseName} onChange={e => setExerciseName(e.target.value)} /></label><label>Weight type<select value={loadType} onChange={e => setLoadType(e.target.value as Exercise['load'])}><option value="absolute">Absolute weight</option><option value="bodyweight">Bodyweight</option><option value="weighted">Bodyweight + added weight</option></select></label><label>How do you count it?<select value={unit} onChange={e => setUnit(e.target.value as Exercise['unit'])}><option value="reps">Reps</option><option value="seconds">Seconds</option></select></label><button className="button-primary full-button" onClick={saveExercise}>Save exercise <span>→</span></button></div>}
      {modal === 'import' && <div className="form-stack import-form"><p className="import-instructions">Upload a CSV with one row per exercise. Rows with the same date and workout name become one log. Dates should use YYYY-MM-DD, and exercise names must match your library.</p><button type="button" className="template-button" onClick={downloadCsvTemplate}>↓ Download CSV template</button><label className="file-picker">Choose a CSV file<input type="file" accept=".csv,text/csv" onChange={e => void readImportFile(e.target.files?.[0])}/></label>{importFileName && <div className="import-file-name">Selected: {importFileName}</div>}{importErrors.length > 0 && <div className="import-errors"><strong>Fix these rows before importing:</strong><ul>{importErrors.slice(0, 8).map((error, index) => <li key={index}>{error}</li>)}</ul>{importErrors.length > 8 && <span>And {importErrors.length - 8} more issues.</span>}</div>}{!importErrors.length && importLogs.length > 0 && <div className="import-preview"><strong>Ready to import</strong><span>{importLogs.length} workout logs · {importLogs.reduce((n, log) => n + log.items.length, 0)} exercise entries</span></div>}<button className="button-primary full-button" disabled={!importLogs.length || importErrors.length > 0} onClick={() => void saveImportedLogs()}>Import workouts <span>→</span></button></div>}
      {modal === 'manual' && <div className="form-stack"><label>Workout name<input autoFocus placeholder="e.g. Quick evening session" value={workoutName} onChange={e => setWorkoutName(e.target.value)} /></label><div className="form-divider">EXERCISES COMPLETED</div>{workoutItems.map((item, idx) => <div className="workout-form-item" key={idx}><select value={item.exerciseId} onChange={e => setWorkoutItems(workoutItems.map((it, n) => n === idx ? {...it, exerciseId:e.target.value} : it))}>{allExercises.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}</select><input aria-label="Sets" type="number" min="1" value={item.sets} onChange={e=>setWorkoutItems(workoutItems.map((it,n)=>n===idx?{...it,sets:+e.target.value}:it))}/><span>sets ×</span><input aria-label="Reps or seconds" type="number" min="1" value={item.reps} onChange={e=>setWorkoutItems(workoutItems.map((it,n)=>n===idx?{...it,reps:+e.target.value}:it))}/><span>{exercise(item.exerciseId)?.unit === 'seconds' ? 'sec' : 'reps'}</span><input className="weight-input" aria-label="Weight in kilograms, optional" type="number" min="0" step="0.5" placeholder="kg" value={item.weight || ''} onChange={e=>setWorkoutItems(workoutItems.map((it,n)=>n===idx?{...it,weight:+e.target.value}:it))}/><button aria-label="Remove exercise" onClick={()=>setWorkoutItems(workoutItems.filter((_,n)=>n!==idx))}>×</button></div>)}{allExercises.length ? <button className="add-exercise-line" onClick={()=>setWorkoutItems([...workoutItems,{exerciseId:allExercises[0].id,sets:3,reps:10,weight:0}])}>＋ Add exercise</button> : <button className="add-exercise-line" onClick={()=>setModal('exercise')}>＋ Create an exercise first</button>}<button className="button-primary full-button" disabled={!allExercises.length || !workoutItems.length || !workoutName.trim()} onClick={saveManualLog}>Save to logs <span>→</span></button></div>}
      {(modal === 'workout' || modal === 'workout-edit') && <div className="form-stack"><label>Workout name<input autoFocus placeholder="e.g. Upper body strength" value={workoutName} onChange={e => setWorkoutName(e.target.value)} /></label><div className="form-divider">SCHEDULE ON</div><div className="weekday-picker">{weekDays.map(day => <label key={day} className={`weekday-option ${workoutDays.includes(day) ? 'assigned' : ''}`}><input type="checkbox" checked={workoutDays.includes(day)} onChange={() => setWorkoutDays(workoutDays.includes(day) ? workoutDays.filter(d => d !== day) : [...workoutDays, day])}/><span>{day}</span></label>)}</div><span className="form-hint">Choose one or more days, or leave them all unchecked for an unscheduled workout.</span><div className="form-divider">EXERCISES IN THIS WORKOUT</div>{workoutItems.map((item, idx) => <div className="workout-form-item" key={idx}><div className="reorder-controls"><button disabled={idx === 0} aria-label={`Move ${exercise(item.exerciseId)?.name ?? 'exercise'} up`} onClick={() => moveWorkoutItem(idx, -1)}>↑</button><button disabled={idx === workoutItems.length - 1} aria-label={`Move ${exercise(item.exerciseId)?.name ?? 'exercise'} down`} onClick={() => moveWorkoutItem(idx, 1)}>↓</button></div><select value={item.exerciseId} onChange={e => setWorkoutItems(workoutItems.map((it, n) => n === idx ? {...it, exerciseId:e.target.value} : it))}>{allExercises.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}</select><input aria-label="Sets" type="number" min="1" value={item.sets} onChange={e=>setWorkoutItems(workoutItems.map((it,n)=>n===idx?{...it,sets:+e.target.value}:it))}/><span>sets ×</span><input aria-label="Reps or seconds" type="number" min="1" value={item.reps} onChange={e=>setWorkoutItems(workoutItems.map((it,n)=>n===idx?{...it,reps:+e.target.value}:it))}/><span>{exercise(item.exerciseId)?.unit === 'seconds' ? 'sec' : 'reps'}</span><input className="weight-input" aria-label="Weight in kilograms, optional" type="number" min="0" step="0.5" placeholder="kg" value={item.weight || ''} onChange={e=>setWorkoutItems(workoutItems.map((it,n)=>n===idx?{...it,weight:+e.target.value}:it))}/><button onClick={()=>setWorkoutItems(workoutItems.filter((_,n)=>n!==idx))}>×</button></div>)}<button className="add-exercise-line" disabled={!allExercises.length} onClick={()=>setWorkoutItems([...workoutItems,{exerciseId:allExercises[0]?.id??'',sets:3,reps:10,weight:0}])}>＋ Add exercise</button><button className="button-primary full-button" disabled={!allExercises.length || !workoutItems.length || !workoutName.trim()} onClick={saveWorkout}>{modal === 'workout-edit' ? 'Save workout changes' : 'Save workout'} <span>→</span></button></div>}
      {modal === 'log' && editing && (editing.restDay ? <div className="form-stack"><p className="rest-log-copy">You marked {fmt(editing.date)} as a completed rest day.</p><div className="modal-footer"><button className="delete-log-button" onClick={()=>deleteLog(editing.id)}>Remove completion</button><button className="button-primary" onClick={()=>setModal(null)}>Done</button></div></div> : <div className="form-stack"><label>Workout name<input value={editing.workout} onChange={e=>setEditing({...editing,workout:e.target.value})}/></label><div className="form-divider">EXERCISES · {fmt(editing.date)}</div>{editing.items.map((item,idx)=><div className="edit-log-item" key={idx}><strong>{exercise(item.exerciseId)?.name ?? 'Exercise'}</strong><div className="edit-log-fields"><label>Sets<input type="number" min="1" value={item.sets} onChange={e=>updateLogItem(idx,'sets',+e.target.value)}/></label><label>{exercise(item.exerciseId)?.unit === 'seconds' ? 'Seconds' : 'Reps'}<input type="number" min="1" value={item.reps} onChange={e=>updateLogItem(idx,'reps',+e.target.value)}/></label>{item.weight>0&&<label>Weight<input type="number" value={item.weight} onChange={e=>updateLogItem(idx,'weight',+e.target.value)}/></label>}</div></div>)}<div className="modal-footer"><button className="delete-log-button" onClick={()=>deleteLog(editing.id)}>Delete session</button><button className="button-primary" onClick={saveLog}>Save changes</button></div></div>)}
    </div></div>}
  </div>
}
export default App
