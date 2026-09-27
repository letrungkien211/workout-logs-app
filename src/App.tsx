import { useEffect, useMemo, useState } from 'react'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import './App.css'

type Exercise = { id: string; name: string; load: 'bodyweight' | 'weighted' | 'absolute'; unit: 'reps' | 'seconds' }
type Item = { exerciseId: string; sets: number; reps: number; weight: number }
type Workout = { id: string; name: string; day: string; items: Item[] }
type Log = { id: string; workout: string; date: string; items: Item[] }
type Modal = 'exercise' | 'workout' | 'log' | null

const uid = () => Math.random().toString(36).slice(2, 10)
const todayName = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(new Date())
const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())

function App() {
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [tab, setTab] = useState('Today')
  const [modal, setModal] = useState<Modal>(null)
  const [editing, setEditing] = useState<Log | null>(null)
  const [selected, setSelected] = useState('all')
  const [page, setPage] = useState(1)
  const [done, setDone] = useState<string[]>([])
  const [exerciseName, setExerciseName] = useState('')
  const [loadType, setLoadType] = useState<Exercise['load']>('absolute')
  const [unit, setUnit] = useState<Exercise['unit']>('reps')
  const [workoutName, setWorkoutName] = useState('')
  const [workoutDay, setWorkoutDay] = useState(todayName)
  const [workoutItems, setWorkoutItems] = useState<Item[]>([{ exerciseId: 'e1', sets: 3, reps: 10, weight: 0 }])
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [dataReady, setDataReady] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')

  useEffect(() => onAuthStateChanged(auth, nextUser => { setUser(nextUser); setAuthReady(true) }), [])
  useEffect(() => {
    if (!user) { setExercises([]); setWorkouts([]); setLogs([]); setDataReady(false); return }
    setDataReady(false)
    const base = `users/${user.uid}`
    const fail = () => { setAuthError('Could not read your workout data. Check that Firestore is enabled and its security rules are deployed.'); setDataReady(true) }
    const unsubs = [
      onSnapshot(collection(db, `${base}/exercises`), snap => { setExercises(snap.docs.map(d => d.data() as Exercise)); setDataReady(true) }, fail),
      onSnapshot(collection(db, `${base}/workouts`), snap => { setWorkouts(snap.docs.map(d => d.data() as Workout)); setDataReady(true) }, fail),
      onSnapshot(collection(db, `${base}/logs`), snap => { setLogs(snap.docs.map(d => d.data() as Log)); setDataReady(true) }, fail),
    ]
    return () => unsubs.forEach(unsub => unsub())
  }, [user])
  const saveRecord = async <T extends { id: string }>(kind: 'exercises' | 'workouts' | 'logs', value: T) => {
    if (!user) return
    try { await setDoc(doc(db, 'users', user.uid, kind, value.id), value) }
    catch { setAuthError('Could not save your changes. Check your connection and Firestore security rules.') }
  }
  const removeRecord = async (kind: 'exercises' | 'workouts' | 'logs', id: string) => {
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
  const exercise = (id: string) => exercises.find(e => e.id === id)
  const todayWorkouts = workouts.filter(w => w.day === todayName)
  const filtered = useMemo(() => logs.filter(l => selected === 'all' || l.items.some(i => i.exerciseId === selected)), [logs, selected])
  const paged = filtered.slice((page - 1) * 20, page * 20)
  const recent = [...logs].sort((a, b) => +new Date(b.date) - +new Date(a.date)).slice(0, 3)
  const openWorkout = () => { setWorkoutName(''); setWorkoutDay(todayName); setWorkoutItems([{ exerciseId: exercises[0]?.id ?? '', sets: 3, reps: 10, weight: 0 }]); setModal('workout') }
  const saveWorkout = () => { if (!workoutName.trim() || !workoutItems.length) return; const created = { id: uid(), name: workoutName.trim(), day: workoutDay, items: workoutItems }; setWorkouts([...workouts, created]); void saveRecord('workouts', created); setModal(null) }
  const completeWorkout = (w: Workout) => { if (done.includes(w.id)) return; const log = { id: uid(), workout: w.name, date: new Date().toISOString(), items: w.items.map(i => ({ ...i })) }; setLogs([log, ...logs]); void saveRecord('logs', log); setDone([...done, w.id]) }
  const changeItem = (id: string, key: 'sets' | 'reps', amount: number) => { const changed = workouts.map(w => w.id === id ? { ...w, items: w.items.map(i => ({ ...i, [key]: Math.max(1, i[key] + amount) })) } : w); setWorkouts(changed); const updated = changed.find(w => w.id === id); if (updated) void saveRecord('workouts', updated) }
  const saveExercise = () => { if (!exerciseName.trim()) return; const created = { id: uid(), name: exerciseName.trim(), load: loadType, unit }; setExercises([...exercises, created]); void saveRecord('exercises', created); setExerciseName(''); setModal(null) }
  const openLog = (log: Log) => { setEditing(log); setModal('log') }
  const saveLog = () => { if (editing) { setLogs(logs.map(l => l.id === editing.id ? editing : l)); void saveRecord('logs', editing) }; setModal(null) }
  const deleteLog = (id: string) => { setLogs(logs.filter(l => l.id !== id)); void removeRecord('logs', id); setModal(null) }
  const updateLogItem = (index: number, key: keyof Item, value: number) => { if (!editing) return; const items = editing.items.map((item, i) => i === index ? { ...item, [key]: value } : item); setEditing({ ...editing, items }) }
  const fmt = (d: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(d))
  const itemSummary = (items: Item[]) => items.map(i => exercise(i.exerciseId)?.name).filter(Boolean).join(' · ')

  if (!authReady) return <div className="auth-screen"><div className="auth-brand"><span className="brand-mark">f</span> form<span className="brand-period">.</span></div><div className="auth-panel"><span className="sparkle">✳</span><h1>Your training, all in one place.</h1><p>Sign in to open your private workout space.</p><div className="auth-loading">Checking sign-in…</div></div></div>
  if (!user) return <div className="auth-screen"><div className="auth-brand"><span className="brand-mark">f</span> form<span className="brand-period">.</span></div><div className="auth-panel"><span className="sparkle">✳</span><div className="eyebrow">A SPACE JUST FOR YOU</div><h1>Your training, all in one place.</h1><p>Sign in to open your private workout space. Your workouts are only available to your account.</p><button className="google-button" disabled={authBusy} onClick={handleAuth}><span className="google-g">G</span>{authBusy ? 'Connecting to Google…' : 'Continue with Google'}<span>→</span></button>{authError && <div className="auth-error">{authError}</div>}<div className="auth-private">🔒 &nbsp;Your account is required to view any workout data.</div></div></div>
  if (!dataReady) return <div className="auth-screen"><div className="auth-brand"><span className="brand-mark">f</span> form<span className="brand-period">.</span></div><div className="auth-panel"><div className="eyebrow">YOUR PRIVATE WORKSPACE</div><h1>Getting your space ready.</h1><p>Loading your workouts from Firestore…</p></div></div>

  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#" onClick={e => { e.preventDefault(); setTab('Today') }}><span className="brand-mark">f</span><span>form<span className="brand-period">.</span></span></a>
      <div className="side-label">WORKSPACE</div><nav>{[['Today', '◷'], ['Schedule', '▦'], ['Exercises', '⌁'], ['All logs', '☷']].map(([name, icon]) => <button key={name} className={`nav-link ${tab === name ? 'active' : ''}`} onClick={() => setTab(name)}><span className="nav-icon">{icon}</span>{name}{name === 'Today' && todayWorkouts.length > 0 && <span className="nav-count">{todayWorkouts.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="coach-note"><span className="sparkle">✳</span><strong>Small steps add up.</strong><p>Show up for yourself today.</p><div className="note-line" /></div><button className="user-profile" onClick={handleAuth} disabled={authBusy}><div className="avatar">{user?.photoURL ? <img src={user.photoURL} alt="" /> : user?.displayName?.charAt(0) ?? 'G'}</div><div><strong>{authBusy ? 'Connecting…' : user?.displayName ?? 'Google sign-in'}</strong><span>{user ? 'Sign out' : 'Sign in / create account'}</span></div><span className="profile-dots">{user ? '↪' : '→'}</span></button>{authError && <div className="auth-error">{authError}</div>}</div>
    </aside>
    <main className="main-content"><header className="topbar"><div className="mobile-brand"><span className="brand-mark">f</span><span>form<span className="brand-period">.</span></span></div><div className="breadcrumb">Workspace <span>/</span> <b>{tab}</b></div><div className="top-actions"><button className="icon-button" aria-label="Search" onClick={() => setTab('All logs')}>⌕</button><div className="top-avatar">Y</div></div></header>
      <div className="page-wrap">{authError && <div className="auth-banner">{authError}<button onClick={() => setAuthError('')}>×</button></div>}{tab === 'Today' && <>
        <div className="greeting-row"><div><div className="eyebrow">YOUR TRAINING, YOUR PACE</div><h1>Make today count<span className="title-period">.</span></h1><p className="date-line">{dateLabel}<span className="date-dot">·</span><span className="weather">A good day to move</span></p></div><div className="streak-card"><span className="streak-icon">✳</span><div><strong>{logs.length ? 'Keep your rhythm' : 'Start your rhythm'}</strong><span>{logs.length} sessions logged so far</span></div></div></div>
        <section className="today-section"><div className="section-heading"><div><div className="section-kicker">ON THE PLAN</div><h2>Today's workout</h2></div><button className="text-button" onClick={() => setTab('Schedule')}>View schedule <span>↗</span></button></div>
          {todayWorkouts.length ? <div className="workout-list">{todayWorkouts.map((w, wi) => <article className={`workout-card ${done.includes(w.id) ? 'completed' : ''}`} key={w.id}><div className="workout-top"><div className={`workout-symbol symbol-${wi % 3}`}>{wi === 0 ? '↗' : wi === 1 ? '⌁' : '✳'}</div><div className="workout-heading"><span className="workout-category">{w.items.length} EXERCISES <i>·</i> {w.items.reduce((n, i) => n + i.sets, 0)} SETS</span><h3>{w.name}</h3></div><label className="check-control"><input type="checkbox" checked={done.includes(w.id)} onChange={() => completeWorkout(w)} aria-label={`Complete ${w.name}`} /><span /></label></div><div className="workout-exercises">{w.items.map((i, idx) => { const e = exercise(i.exerciseId); return <div className="exercise-line" key={i.exerciseId + idx}><div className="exercise-info"><span className="exercise-bullet">{String(idx + 1).padStart(2, '0')}</span><span className="exercise-name">{e?.name ?? 'Exercise'}</span><span className="exercise-detail">{i.weight > 0 ? `${i.weight} kg · ` : ''}{e?.unit === 'seconds' ? `${i.reps}s` : `${i.reps} reps`}</span></div><div className="stepper"><button onClick={() => changeItem(w.id, 'reps', -1)} aria-label="Decrease reps">−</button><span>{i.sets} × {i.reps}</span><button onClick={() => changeItem(w.id, 'reps', 1)} aria-label="Increase reps">+</button></div></div> })}</div>{done.includes(w.id) && <div className="completed-note">✓ Workout logged. Nice work.</div>}</article>)}</div> : <div className="empty-state"><span>✳</span><strong>A little movement goes a long way.</strong><p>Nothing scheduled for today. Add a workout or check your schedule.</p><button className="button-primary" onClick={openWorkout}>＋ Create workout</button></div>}
        </section>
        <section className="recent-section"><div className="section-heading"><div><div className="section-kicker">THE WORK YOU PUT IN</div><h2>Recent sessions</h2></div><button className="text-button" onClick={() => setTab('All logs')}>All logs <span>↗</span></button></div><div className="recent-list">{recent.length ? recent.map(log => <button className="recent-row" key={log.id} onClick={() => openLog(log)}><div className="recent-date"><strong>{fmt(log.date).split(' ')[1]}</strong><span>{fmt(log.date).split(' ')[0].toUpperCase()}</span></div><div className="recent-info"><strong>{log.workout}</strong><span>{itemSummary(log.items)}</span></div><span className="recent-volume">{log.items.reduce((s, i) => s + i.sets, 0)} sets</span><span className="chevron">›</span></button>) : <div className="empty-small">Your completed workouts will show up here.</div>}</div></section>
        <div className="bottom-quote"><span>“</span><p>Consistency is a form of self-respect.</p><span className="quote-end">✳</span></div>
      </>}
      {tab === 'Schedule' && <><div className="page-intro"><div className="eyebrow">PLAN AHEAD</div><h1>Your schedule<span className="title-period">.</span></h1><p>Build a rhythm that works for you.</p><button className="button-primary" onClick={openWorkout}>＋ Add workout</button></div><div className="schedule-grid">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => <div className="day-column" key={day}><div className={`day-header ${day === todayName ? 'is-today' : ''}`}><span>{day}</span>{day === todayName && <i>Today</i>}</div>{workouts.filter(w => w.day === day).map(w => <article className="schedule-card" key={w.id}><span className="schedule-dot"/><strong>{w.name}</strong><span>{w.items.length} exercises</span><button aria-label={`Delete ${w.name}`} onClick={() => { setWorkouts(workouts.filter(x => x.id !== w.id)); void removeRecord('workouts', w.id) }}>×</button></article>)}<button className="add-to-day" onClick={() => { openWorkout(); setWorkoutDay(day) }}>＋ Add</button></div>)}</div><div className="schedule-tip"><span>✳</span> Your plan is flexible. Move things around whenever life happens.</div></>}
      {tab === 'Exercises' && <><div className="page-intro"><div className="eyebrow">YOUR MOVEMENT LIBRARY</div><h1>Exercises<span className="title-period">.</span></h1><p>Build a library that fits the way you train.</p><button className="button-primary" onClick={() => setModal('exercise')}>＋ Add exercise</button></div><div className="library-list">{exercises.map((e, i) => <div className="library-row" key={e.id}><span className={`library-icon library-${i % 3}`}>{['↗','⌁','✳'][i % 3]}</span><div className="library-info"><strong>{e.name}</strong><span>{e.load === 'bodyweight' ? 'Bodyweight' : e.load === 'weighted' ? 'Bodyweight + weight' : 'Absolute weight'} <i>·</i> {e.unit === 'reps' ? 'Reps' : 'Seconds'}</span></div><button className="delete-exercise" onClick={() => { setExercises(exercises.filter(x => x.id !== e.id)); void removeRecord('exercises', e.id) }} aria-label={`Delete ${e.name}`}>×</button></div>)}</div></>}
      {tab === 'All logs' && <><div className="page-intro log-intro"><div className="eyebrow">EVERY REP COUNTS</div><h1>Workout logs<span className="title-period">.</span></h1><p>A record of showing up for yourself.</p><button className="button-primary" onClick={openWorkout}>＋ Log a workout</button></div><div className="log-toolbar"><label className="filter-label">FILTER BY EXERCISE<select value={selected} onChange={e => { setSelected(e.target.value); setPage(1) }}><option value="all">All exercises</option>{exercises.map(e => <option value={e.id} key={e.id}>{e.name}</option>)}</select></label><span className="result-count">{filtered.length} {filtered.length === 1 ? 'session' : 'sessions'}</span></div><div className="all-logs">{paged.map(log => <button className="log-row" key={log.id} onClick={() => openLog(log)}><div className="log-date"><strong>{new Date(log.date).getDate()}</strong><span>{new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(new Date(log.date))}</span></div><div className="log-main"><strong>{log.workout}</strong><span>{itemSummary(log.items)}</span></div><span className="log-sets">{log.items.reduce((s, i) => s + i.sets, 0)} sets</span><span className="chevron">›</span></button>)}</div>{!paged.length && <div className="empty-small">No sessions match this exercise yet.</div>}<div className="pagination"><span>Showing {filtered.length ? (page - 1) * 20 + 1 : 0}–{Math.min(page * 20, filtered.length)} of {filtered.length}</span><div><button disabled={page === 1} onClick={() => setPage(page - 1)}>←</button><span>{page} / {Math.max(1, Math.ceil(filtered.length / 20))}</span><button disabled={page >= Math.ceil(filtered.length / 20)} onClick={() => setPage(page + 1)}>→</button></div></div></>}
      </div>
      <nav className="mobile-nav">{[['Today','◷'],['Schedule','▦'],['Exercises','⌁'],['All logs','☷']].map(([name,icon])=><button key={name} className={tab===name?'active':''} onClick={()=>setTab(name)}><span>{icon}</span>{name}</button>)}</nav>
    </main>
    {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setModal(null) }}><div className="modal-card"><div className="modal-top"><div><div className="eyebrow">{modal === 'exercise' ? 'MOVEMENT LIBRARY' : modal === 'workout' ? 'MAKE A PLAN' : 'SESSION DETAILS'}</div><h2>{modal === 'exercise' ? 'Add an exercise' : modal === 'workout' ? 'Create a workout' : 'Edit session'}</h2></div><button className="modal-close" onClick={() => setModal(null)}>×</button></div>
      {modal === 'exercise' && <div className="form-stack"><label>Exercise name<input autoFocus placeholder="e.g. Goblet squat" value={exerciseName} onChange={e => setExerciseName(e.target.value)} /></label><label>Weight type<select value={loadType} onChange={e => setLoadType(e.target.value as Exercise['load'])}><option value="absolute">Absolute weight</option><option value="bodyweight">Bodyweight</option><option value="weighted">Bodyweight + added weight</option></select></label><label>How do you count it?<select value={unit} onChange={e => setUnit(e.target.value as Exercise['unit'])}><option value="reps">Reps</option><option value="seconds">Seconds</option></select></label><button className="button-primary full-button" onClick={saveExercise}>Save exercise <span>→</span></button></div>}
      {modal === 'workout' && <div className="form-stack"><label>Workout name<input autoFocus placeholder="e.g. Upper body strength" value={workoutName} onChange={e => setWorkoutName(e.target.value)} /></label><label>Scheduled day<select value={workoutDay} onChange={e => setWorkoutDay(e.target.value)}>{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <option key={d}>{d}</option>)}</select></label><div className="form-divider">EXERCISES IN THIS WORKOUT</div>{workoutItems.map((item, idx) => <div className="workout-form-item" key={idx}><select value={item.exerciseId} onChange={e => setWorkoutItems(workoutItems.map((it, n) => n === idx ? {...it, exerciseId:e.target.value} : it))}>{exercises.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}</select><input aria-label="Sets" type="number" min="1" value={item.sets} onChange={e=>setWorkoutItems(workoutItems.map((it,n)=>n===idx?{...it,sets:+e.target.value}:it))}/><span>sets ×</span><input aria-label="Reps or seconds" type="number" min="1" value={item.reps} onChange={e=>setWorkoutItems(workoutItems.map((it,n)=>n===idx?{...it,reps:+e.target.value}:it))}/><span>{exercise(item.exerciseId)?.unit === 'seconds' ? 'sec' : 'reps'}</span><input className="weight-input" aria-label="Weight in kilograms, optional" type="number" min="0" step="0.5" placeholder="kg" value={item.weight || ''} onChange={e=>setWorkoutItems(workoutItems.map((it,n)=>n===idx?{...it,weight:+e.target.value}:it))}/><button onClick={()=>setWorkoutItems(workoutItems.filter((_,n)=>n!==idx))}>×</button></div>)}<button className="add-exercise-line" disabled={!exercises.length} onClick={()=>setWorkoutItems([...workoutItems,{exerciseId:exercises[0]?.id??'',sets:3,reps:10,weight:0}])}>＋ Add exercise</button><button className="button-primary full-button" disabled={!exercises.length} onClick={saveWorkout}>Save workout <span>→</span></button></div>}
      {modal === 'log' && editing && <div className="form-stack"><label>Workout name<input value={editing.workout} onChange={e=>setEditing({...editing,workout:e.target.value})}/></label><div className="form-divider">EXERCISES · {fmt(editing.date)}</div>{editing.items.map((item,idx)=><div className="edit-log-item" key={idx}><strong>{exercise(item.exerciseId)?.name ?? 'Exercise'}</strong><div className="edit-log-fields"><label>Sets<input type="number" min="1" value={item.sets} onChange={e=>updateLogItem(idx,'sets',+e.target.value)}/></label><label>{exercise(item.exerciseId)?.unit === 'seconds' ? 'Seconds' : 'Reps'}<input type="number" min="1" value={item.reps} onChange={e=>updateLogItem(idx,'reps',+e.target.value)}/></label>{item.weight>0&&<label>Weight<input type="number" value={item.weight} onChange={e=>updateLogItem(idx,'weight',+e.target.value)}/></label>}</div></div>)}<div className="modal-footer"><button className="delete-log-button" onClick={()=>deleteLog(editing.id)}>Delete session</button><button className="button-primary" onClick={saveLog}>Save changes</button></div></div>}
    </div></div>}
  </div>
}
export default App
