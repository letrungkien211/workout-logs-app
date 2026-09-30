import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from 'react'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { collection, deleteDoc, doc, onSnapshot, setDoc, writeBatch } from 'firebase/firestore'
import { auth, db } from './firebase'
import { exerciseCatalog, type Exercise } from './exerciseCatalog'
import './App.css'

type Item = { id?: string; exerciseId: string; sets: number; reps: number; weight: number }
type Workout = { id: string; name: string; days: string[]; day?: string; items: Item[]; iconExerciseId?: string }
type Log = { id: string; workout: string; date: string; items: Item[]; restDay?: boolean; workoutId?: string }
type Modal = 'exercise' | 'workout' | 'workout-edit' | 'manual' | 'import' | 'export' | 'log' | null

const uid = () => Math.random().toString(36).slice(2, 10)
const jstTimeZone = 'Asia/Tokyo'
const jstDateKey = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: jstTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type: string) => parts.find(value => value.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
const jstWeekStartKey = (date: Date) => {
  const [year, month, day] = jstDateKey(date).split('-').map(Number)
  const monday = new Date(Date.UTC(year, month - 1, day))
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7)
  return monday.toISOString().slice(0, 10)
}
const shiftDateKey = (key: string, days: number) => {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}
const formatWeekLabel = (key: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}T00:00:00Z`))
const todayName = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: jstTimeZone }).format(new Date())
const weekDays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const tabSlugs: Record<string, string> = { Today: 'today', Schedule: 'schedule', Exercises: 'exercises', 'All logs': 'logs' }
const tabFromUrl = () => Object.entries(tabSlugs).find(([, slug]) => slug === new URLSearchParams(window.location.search).get('tab'))?.[0] ?? 'Today'
const strengthLevelExerciseSlugs: Record<string, string> = {
  'catalog-barbell-back-squat': 'squat', 'catalog-conventional-deadlift': 'deadlift', 'catalog-barbell-bench-press': 'bench-press',
  'catalog-dumbbell-bench-press': 'dumbbell-bench-press', 'catalog-push-up': 'push-ups', 'catalog-overhead-press': 'shoulder-press',
  'catalog-pull-up': 'pull-ups', 'catalog-dumbbell-bicep-curl': 'dumbbell-curl', 'catalog-barbell-curl': 'barbell-curl', 'catalog-leg-press': 'sled-leg-press',
  'catalog-incline-dumbbell-press': 'incline-dumbbell-bench-press'
}
function ExerciseIcon({ exercise }: { exercise: Exercise }) {
  const slug = strengthLevelExerciseSlugs[exercise.id]
  return slug
    ? <img className="library-icon exercise-catalog-icon" src={`https://static.strengthlevel.com/images/exercises/${slug}/icons/${slug}-icon-128.webp`} alt="" loading="lazy" />
    : <span className="library-icon exercise-fallback-icon" aria-hidden="true"><svg viewBox="0 0 48 48"><circle cx="24" cy="8" r="5"/><path d="M20 15h8l4 10-5 5 3 14h-6l-3-11-3 11h-6l5-17-5-7 4-5h4l4 7 4-3-2-6zM3 21h7v6H3zm35 0h7v6h-7zM9 19h4v10H9zm26 0h4v10h-4zM13 22h22v4H13z"/></svg></span>
}
function WorkoutIcon({ workout, exercises }: { workout: Workout; exercises: Exercise[] }) {
  const iconExercise = [...exerciseCatalog, ...exercises].find(item => item.id === (workout.iconExerciseId ?? workout.items[0]?.exerciseId))
  return iconExercise ? <ExerciseIcon exercise={iconExercise} /> : <span className="library-icon exercise-fallback-icon" aria-hidden="true">✳</span>
}
type ProgressPoint = { label: string; value: number }
type ProgressSeries = { id: string; name: string; color: string; points: ProgressPoint[] }
function ProgressChart({ title, unit, series }: { title: string; unit: string; series: ProgressSeries[] }) {
  const width = 640, height = 220, left = 42, right = 14, top = 14, bottom = 34
  const plotWidth = width - left - right, plotHeight = height - top - bottom
  const max = Math.max(1, ...series.flatMap(item => item.points.map(point => point.value)))
  const paths = series.map(item => {
    const coords = item.points.map((point, index) => ({ ...point, x: left + (item.points.length <= 1 ? plotWidth / 2 : index * plotWidth / (item.points.length - 1)), y: top + plotHeight - point.value / max * plotHeight }))
    return { ...item, coords, path: coords.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ') }
  })
  const labels = series[0]?.points ?? []
  return <article className="progress-chart-card"><div className="progress-chart-heading"><div><strong>{title}</strong><span>{unit}</span></div></div><div className="progress-chart-scroll"><svg className="progress-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} by week`}>
    {[0, .5, 1].map(ratio => { const y = top + plotHeight * (1 - ratio); const value = max * ratio; const label = unit === 'kg' ? Number(value.toFixed(2)).toString() : Math.round(value).toString(); return <g key={ratio}><line x1={left} y1={y} x2={width - right} y2={y} className="progress-grid-line"/><text x={left - 8} y={y + 3} textAnchor="end" className="progress-axis-label">{label}</text></g> })}
    {paths.map(item => <g key={item.id}><path d={item.path} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>{item.coords.map(point => <circle key={point.label} cx={point.x} cy={point.y} r="4" fill={item.color} stroke="#fff" strokeWidth="2"><title>{item.name} · {point.label}: {point.value} {unit}</title></circle>)}</g>)}
    {labels.map((point, index) => (index === 0 || index === Math.floor((labels.length - 1) / 2) || index === labels.length - 1) && <text key={point.label} x={left + (labels.length <= 1 ? plotWidth / 2 : index * plotWidth / (labels.length - 1))} y={height - 8} textAnchor="middle" className="progress-axis-label">{point.label}</text>)}
  </svg><div className="progress-chart-legend">{series.map(item => { const maxValue = Math.max(0, ...item.points.map(point => point.value)); const suffix = unit === 'kg' ? ` (${Number(maxValue.toFixed(2))}kg)` : ''; return <span key={item.id}><i style={{ backgroundColor: item.color }}/>{item.name}{suffix}</span> })}</div></div></article>
}

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

const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
const parseImportDate = (value: string) => {
  if (/^\d{10,13}$/.test(value)) {
    const timestamp = Number(value)
    return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp)
  }
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00+09:00` : value)
}

type NumericInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number
  onValueChange: (value: number) => void
  emptyAsBlank?: boolean
}

function NumericInput({ value, onValueChange, emptyAsBlank = false, min = 0, onFocus, onBlur, ...props }: NumericInputProps) {
  const [draft, setDraft] = useState(String(value))
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setDraft(String(value))
  }, [value])

  return <input {...props} type="number" min={min} value={draft}
    onFocus={event => { focused.current = true; onFocus?.(event) }}
    onChange={event => {
      const raw = event.target.value
      const next = raw.replace(/^(-?)0+(?=\d)/, '$1')
      setDraft(next)
      if (next !== '' && Number.isFinite(Number(next))) onValueChange(Number(next))
    }}
    onBlur={event => {
      focused.current = false
      if (draft === '') {
        onValueChange(Number(min))
        setDraft(emptyAsBlank ? '' : String(min))
      } else {
        const next = Number(draft)
        setDraft(String(next))
        onValueChange(next)
      }
      onBlur?.(event)
    }} />
}

function App() {
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [tab, setTab] = useState(tabFromUrl)
  const [modal, setModal] = useState<Modal>(null)
  const [editing, setEditing] = useState<Log | null>(null)
  const [editingWorkout, setEditingWorkout] = useState<Workout | null>(null)
  const [importLogs, setImportLogs] = useState<Log[]>([])
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importFileName, setImportFileName] = useState('')
  const [exportStartDate, setExportStartDate] = useState('')
  const [exportEndDate, setExportEndDate] = useState('')
  const [selected, setSelected] = useState('all')
  const [progressFavorites, setProgressFavorites] = useState<string[]>([])
  const [exerciseSearch, setExerciseSearch] = useState('')
  const [page, setPage] = useState(1)
  const [dayOffset, setDayOffset] = useState(0)
  const [scheduleWeekOffset, setScheduleWeekOffset] = useState(0)
  const [groupLogsByDay, setGroupLogsByDay] = useState(true)
  const [exerciseName, setExerciseName] = useState('')
  const [loadType, setLoadType] = useState<Exercise['load']>('absolute')
  const [unit, setUnit] = useState<Exercise['unit']>('reps')
  const [workoutName, setWorkoutName] = useState('')
  const [workoutDays, setWorkoutDays] = useState<string[]>([todayName])
  const [workoutItems, setWorkoutItems] = useState<Item[]>([{ exerciseId: 'e1', sets: 3, reps: 10, weight: 0 }])
  const [workoutIconExerciseId, setWorkoutIconExerciseId] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [dataReady, setDataReady] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const allExercises = [...exerciseCatalog, ...exercises]
  const searchTerm = exerciseSearch.trim().toLowerCase()
  const filteredFavorites = allExercises.filter(item => progressFavorites.includes(item.id) && item.name.toLowerCase().includes(searchTerm))
  const filteredCatalog = exerciseCatalog.filter(item => !progressFavorites.includes(item.id) && item.name.toLowerCase().includes(searchTerm))
  const filteredExercises = exercises.filter(item => !progressFavorites.includes(item.id) && item.name.toLowerCase().includes(searchTerm))
  const localToolsEnabled = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)

  const navigateTab = (nextTab: string) => {
    setTab(nextTab)
    const url = new URL(window.location.href)
    if (nextTab === 'Today') url.searchParams.delete('tab')
    else url.searchParams.set('tab', tabSlugs[nextTab] ?? 'today')
    window.history.pushState({ tab: nextTab }, '', `${url.pathname}${url.search}${url.hash}`)
  }

  useEffect(() => onAuthStateChanged(auth, nextUser => { setUser(nextUser); setAuthReady(true) }), [])
  useEffect(() => {
    const syncTab = () => setTab(tabFromUrl())
    window.addEventListener('popstate', syncTab)
    return () => window.removeEventListener('popstate', syncTab)
  }, [])
  useEffect(() => {
    if (!user) { setExercises([]); setWorkouts([]); setLogs([]); setProgressFavorites([]); setDataReady(false); return }
    setDataReady(false)
    const base = `users/${user.uid}`
    const fail = () => { setAuthError('Could not read your workout data. Check that Firestore is enabled and its security rules are deployed.'); setDataReady(true) }
    const unsubs = [
      onSnapshot(collection(db, `${base}/exercises`), snap => { setExercises(snap.docs.map(d => d.data() as Exercise)); setDataReady(true) }, fail),
      onSnapshot(collection(db, `${base}/workouts`), snap => { setWorkouts(snap.docs.map(d => { const data = d.data() as Workout; return { ...data, days: data.days ?? (data.day ? [data.day] : []), items: (data.items ?? []).map((item, index) => ({ ...item, id: item.id ?? `${data.id}-item-${index}` })) } })); setDataReady(true) }, fail),
      onSnapshot(collection(db, `${base}/logs`), snap => { setLogs(snap.docs.map(d => d.data() as Log)); setDataReady(true) }, fail),
      onSnapshot(doc(db, `${base}/settings`, 'progress'), snap => { const ids = snap.data()?.exerciseIds; setProgressFavorites(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []) }, fail),
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
  const exercise = (id: string) => allExercises.find(e => e.id === id)
  const favoriteExercises = allExercises.filter(item => progressFavorites.includes(item.id))
  const toggleProgressFavorite = (id: string) => {
    const next = progressFavorites.includes(id) ? progressFavorites.filter(value => value !== id) : [...progressFavorites, id]
    setProgressFavorites(next)
    if (user) void setDoc(doc(db, 'users', user.uid, 'settings', 'progress'), { exerciseIds: next }, { merge: true }).catch(() => setAuthError('Could not save your progress favorites. Check your connection and Firestore security rules.'))
  }
  const progressWeekKeys = Array.from({ length: 12 }, (_, index) => shiftDateKey(jstWeekStartKey(new Date()), (index - 11) * 7))
  const weeklyProgressFor = (exerciseId: string) => {
    const progressByWeek = new Map<string, { reps: number; maxWeight: number }>()
    logs.forEach(log => {
      if (log.restDay) return
      const weekKey = jstWeekStartKey(new Date(log.date))
      log.items.filter(item => item.exerciseId === exerciseId).forEach(item => {
        const value = progressByWeek.get(weekKey) ?? { reps: 0, maxWeight: 0 }
        value.reps += item.sets * item.reps
        value.maxWeight = Math.max(value.maxWeight, item.weight)
        progressByWeek.set(weekKey, value)
      })
    })
    return {
      hasData: progressWeekKeys.some(key => progressByWeek.has(key)),
      reps: progressWeekKeys.map(key => ({ label: formatWeekLabel(key), value: progressByWeek.get(key)?.reps ?? 0 })),
      weight: progressWeekKeys.map(key => ({ label: formatWeekLabel(key), value: progressByWeek.get(key)?.maxWeight ?? 0 }))
    }
  }
  const progressColors = ['#537a47', '#d26a52', '#477da8', '#9466a5', '#c58a35', '#398e82', '#8f5e48', '#65708f']
  const favoriteProgress = favoriteExercises.map((item, index) => ({ item, weekly: weeklyProgressFor(item.id), color: progressColors[index % progressColors.length] }))
  const repsSeries: ProgressSeries[] = favoriteProgress.filter(entry => entry.item.unit === 'reps' && entry.weekly.hasData).map(entry => ({ id: entry.item.id, name: entry.item.name, color: entry.color, points: entry.weekly.reps }))
  const weightSeries: ProgressSeries[] = favoriteProgress.filter(entry => entry.item.load !== 'bodyweight' && entry.weekly.hasData).map(entry => ({ id: entry.item.id, name: entry.item.name, color: entry.color, points: entry.weekly.weight }))
  const viewedDate = new Date(`${jstDateKey(new Date())}T12:00:00+09:00`)
  viewedDate.setUTCDate(viewedDate.getUTCDate() + dayOffset)
  const viewedDayName = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: jstTimeZone }).format(viewedDate)
  const viewedDateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: jstTimeZone }).format(viewedDate)
  const viewedDateTitle = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: jstTimeZone }).format(viewedDate)
  const viewingToday = dayOffset === 0
  const viewedDateKey = jstDateKey(viewedDate)
  const todayWorkouts = workouts.filter(w => w.days.includes(viewedDayName))
  const upcomingWorkoutPreviews = [1, 2, 3].map(daysAhead => {
    const date = new Date(viewedDate)
    date.setUTCDate(date.getUTCDate() + daysAhead)
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: jstTimeZone }).format(date)
    const dayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: jstTimeZone }).format(date)
    return { title: dayOffset === 0 ? daysAhead === 1 ? 'Tomorrow' : `In ${daysAhead} days` : dayLabel, dayLabel, workouts: workouts.filter(workout => workout.days.includes(day)) }
  })
  const sameItem = (a: Item, b: Item) => a.exerciseId === b.exerciseId && a.sets === b.sets && a.reps === b.reps && a.weight === b.weight
  const logForWorkout = (workout: Workout) => logs.find(log => (log.workoutId === workout.id || (!log.workoutId && log.workout === workout.name)) && jstDateKey(new Date(log.date)) === viewedDateKey)
  const isItemDone = (workout: Workout, item: Item, index: number) => {
    const log = logForWorkout(workout)
    if (!log) return false
    if (item.id && log.items.some(logItem => logItem.id === item.id)) return true
    const duplicatePosition = workout.items.slice(0, index + 1).filter(candidate => sameItem(candidate, item)).length
    return log.items.filter(logItem => !logItem.id && sameItem(logItem, item)).length >= duplicatePosition
  }
  const isWorkoutDone = (workout: Workout) => workout.items.length > 0 && workout.items.every((item, index) => isItemDone(workout, item, index))
  const filtered = useMemo(() => logs.filter(l => selected === 'all' || l.items.some(i => i.exerciseId === selected)).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [logs, selected])
  const paged = filtered.slice((page - 1) * 20, page * 20)
  const flatRows = filtered.flatMap(log => log.restDay || !log.items.length ? [{ log, item: null as Item | null }] : log.items.filter(item => selected === 'all' || item.exerciseId === selected).map(item => ({ log, item })))
  const pagedFlatRows = flatRows.slice((page - 1) * 20, page * 20)
  const displayedCount = groupLogsByDay ? filtered.length : flatRows.length
  const recent = [...logs].sort((a, b) => +new Date(b.date) - +new Date(a.date)).slice(0, 10)
  const openWorkout = (day?: string) => { setEditingWorkout(null); setWorkoutName(''); setWorkoutDays(day ? [day] : [todayName]); setWorkoutItems([{ exerciseId: allExercises[0]?.id ?? '', sets: 3, reps: 10, weight: 0 }]); setWorkoutIconExerciseId(''); setModal('workout') }
  const openEditWorkout = (workout: Workout) => { setEditingWorkout(workout); setWorkoutName(workout.name); setWorkoutDays(workout.days); setWorkoutItems(workout.items.map(item => ({ ...item }))); setWorkoutIconExerciseId(workout.iconExerciseId ?? ''); setModal('workout-edit') }
  const openManualLog = () => { setWorkoutName(''); setWorkoutItems([{ exerciseId: allExercises[0]?.id ?? '', sets: 3, reps: 10, weight: 0 }]); setModal('manual') }
  const openImport = () => { setImportLogs([]); setImportErrors([]); setImportFileName(''); setModal('import') }
  const openExport = () => { setExportStartDate(''); setExportEndDate(''); setModal('export') }
  const downloadCsvTemplate = () => {
    const url = URL.createObjectURL(new Blob(['\uFEFFDate,Workout Name,Exercise Name,Sets,Reps,Weight (kg)\r\n'], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'workout-log-template.csv'; anchor.click(); URL.revokeObjectURL(url)
  }
  const exportLogsCsv = () => {
    const rows = [['Date', 'Workout Name', 'Exercise Name', 'Sets', 'Reps', 'Weight (kg)']]
    ;[...logs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).forEach(log => {
      if (log.restDay) return
      const date = jstDateKey(new Date(log.date))
      if ((exportStartDate && date < exportStartDate) || (exportEndDate && date > exportEndDate)) return
      log.items.forEach(item => rows.push([date, log.workout, exercise(item.exerciseId)?.name ?? 'Exercise', String(item.sets), String(item.reps), item.weight > 0 ? String(item.weight) : '']))
    })
    const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `workout-logs-${jstDateKey(new Date())}.csv`; anchor.click(); URL.revokeObjectURL(url)
  }
  const readImportFile = async (file?: File) => {
    if (!file) return
    setImportFileName(file.name); setImportLogs([]); setImportErrors([])
    if (!file.name.toLowerCase().endsWith('.csv')) { setImportErrors(['Please choose a CSV file.']); return }
    const rows = parseCsvRows((await file.text()).replace(/^\uFEFF/, ''))
    if (rows.length < 2) { setImportErrors(['The CSV needs a header row and at least one workout row.']); return }
    const headers = rows[0].map(value => value.toLowerCase().replace(/[\s-]+/g, '_'))
    const column = (...names: string[]) => headers.findIndex(header => names.includes(header))
    const dateIndex = column('date', 'workout_date', 'timestamp', 'datetime', 'start_time')
    const workoutIndex = column('workout', 'workout_name', 'session', 'session_name')
    const exerciseIndex = column('exercise', 'exercise_name', 'movement', 'lift')
    const setsIndex = column('sets', 'set_count', 'number_of_sets')
    const repsIndex = column('reps', 'rep_count', 'count', 'seconds', 'duration')
    const weightIndex = column('weight', 'weight_kg', 'weight_(kg)', 'load')
    const errors: string[] = []
    if (dateIndex < 0 || exerciseIndex < 0 || repsIndex < 0) {
      setImportErrors(['Required columns: date, exercise, reps (or count). Workout name, sets, and weight are optional.'])
      return
    }
    const exercisesByName = new Map(allExercises.map(item => [item.name.trim().toLowerCase(), item]))
    const firstExerciseByDay = new Map<string, string>()
    rows.slice(1).forEach(row => {
      const dateText = row[dateIndex] ?? ''
      const date = parseImportDate(dateText)
      const exerciseItem = exercisesByName.get((row[exerciseIndex] ?? '').toLowerCase())
      if (!Number.isNaN(date.getTime()) && exerciseItem && !firstExerciseByDay.has(jstDateKey(date))) firstExerciseByDay.set(jstDateKey(date), exerciseItem.name)
    })
    const groups = new Map<string, Log>()
    rows.slice(1).forEach((row, index) => {
      const line = index + 2
      const dateText = row[dateIndex] ?? ''
      const date = parseImportDate(dateText)
      const workoutName = row[workoutIndex]?.trim() ?? ''
      const fallbackWorkout = firstExerciseByDay.get(jstDateKey(date)) ?? 'Imported workout'
      const workout = !workoutName || /^unknown$/i.test(workoutName) ? fallbackWorkout : workoutName
      const exerciseName = row[exerciseIndex] ?? ''
      const exerciseItem = exercisesByName.get(exerciseName.toLowerCase())
      const setsText = setsIndex < 0 ? '' : row[setsIndex] ?? ''
      const sets = setsText === '' ? 1 : Number(setsText)
      const reps = Number(row[repsIndex])
      const weightText = weightIndex < 0 ? '' : row[weightIndex] ?? ''
      const weight = weightText === '' ? 0 : Number(weightText)
      if (!dateText || Number.isNaN(date.getTime())) errors.push(`Row ${line}: invalid date “${dateText}”. Use YYYY-MM-DD.`)
      if (!exerciseItem) errors.push(`Row ${line}: “${exerciseName || '(blank)'}” isn’t in your exercise library.`)
      if (!Number.isInteger(sets) || sets < 1) errors.push(`Row ${line}: sets must be a positive whole number.`)
      if (!Number.isFinite(reps) || reps < 1) errors.push(`Row ${line}: reps or seconds must be a positive number.`)
      if (!Number.isFinite(weight) || weight < 0) errors.push(`Row ${line}: weight must be zero or greater.`)
      if (!dateText || Number.isNaN(date.getTime()) || !exerciseItem || !Number.isInteger(sets) || sets < 1 || !Number.isFinite(reps) || reps < 1 || !Number.isFinite(weight) || weight < 0) return
      const dateIso = date.toISOString()
      const key = `${jstDateKey(date)}::${workout.toLowerCase()}`
      const log = groups.get(key) ?? { id: uid(), workout, date: dateIso, items: [] }
      log.items.push({ id: uid(), exerciseId: exerciseItem.id, sets, reps, weight })
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
  const eraseAllLogs = async () => {
    if (!user || !localToolsEnabled || !logs.length) return
    if (!window.confirm(`Erase all ${logs.length} workout logs from your Firebase account? This cannot be undone.`)) return
    try {
      for (let start = 0; start < logs.length; start += 450) {
        const batch = writeBatch(db)
        logs.slice(start, start + 450).forEach(log => batch.delete(doc(db, 'users', user.uid, 'logs', log.id)))
        await batch.commit()
      }
      setLogs([])
    } catch { setAuthError('Could not erase all workout logs. Check your connection and Firestore security rules.') }
  }
  const moveWorkoutItem = (index: number, offset: -1 | 1) => { const destination = index + offset; if (destination < 0 || destination >= workoutItems.length) return; const reordered = [...workoutItems]; [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]]; setWorkoutItems(reordered) }
  const saveWorkout = () => {
    if (!workoutName.trim() || !workoutItems.length) return
    const items = workoutItems.map(item => ({ ...item, id: item.id ?? uid() }))
    const iconExerciseId = workoutIconExerciseId && items.some(item => item.exerciseId === workoutIconExerciseId) ? workoutIconExerciseId : ''
    const workout: Workout = editingWorkout ? { ...editingWorkout, name: workoutName.trim(), days: workoutDays, items } : { id: uid(), name: workoutName.trim(), days: workoutDays, items }
    if (iconExerciseId) workout.iconExerciseId = iconExerciseId
    else delete workout.iconExerciseId
    setWorkouts(editingWorkout ? workouts.map(w => w.id === workout.id ? workout : w) : [...workouts, workout])
    void saveRecord('workouts', workout)
    setEditingWorkout(null)
    setModal(null)
  }
  const saveManualLog = () => { if (!workoutName.trim() || !workoutItems.length) return; const log: Log = { id: uid(), workout: workoutName.trim(), date: new Date().toISOString(), items: workoutItems.map(item => ({ ...item, id: item.id ?? uid() })) }; setLogs([log, ...logs]); void saveRecord('logs', log); setModal(null) }
  const toggleWorkoutDay = (workout: Workout, day: string) => { const assigning = !workout.days.includes(day); const updated = { ...workout, days: assigning ? [...workout.days, day] : workout.days.filter(d => d !== day) }; setWorkouts(workouts.map(w => w.id === workout.id ? updated : w)); void saveRecord('workouts', updated) }
  const normalizeScheduledLogItems = (log: Log, workout: Workout) => {
    const usedIds = new Set<string>()
    return log.items.map((logItem, index) => {
      if (logItem.id) { usedIds.add(logItem.id); return logItem }
      const match = workout.items.find(item => item.id && !usedIds.has(item.id) && sameItem(item, logItem))
      if (match?.id) { usedIds.add(match.id); return { ...logItem, id: match.id } }
      return { ...logItem, id: `legacy-${log.id}-${index}` }
    })
  }
  const completeWorkoutItem = (workout: Workout, item: Item, index: number) => {
    if (!viewingToday) return
    const existing = logForWorkout(workout)
    const normalizedItems = existing ? normalizeScheduledLogItems(existing, workout) : []
    const isDone = item.id ? normalizedItems.some(logItem => logItem.id === item.id) : isItemDone(workout, item, index)
    const nextItems = isDone ? normalizedItems.filter(logItem => logItem.id !== item.id) : [...normalizedItems, { ...item, id: item.id ?? uid() }]
    if (!nextItems.length) {
      if (existing) { setLogs(logs.filter(log => log.id !== existing.id)); void removeRecord('logs', existing.id) }
      return
    }
    const log: Log = existing
      ? { ...existing, workoutId: workout.id, workout: workout.name, items: nextItems }
      : { id: uid(), workoutId: workout.id, workout: workout.name, date: new Date().toISOString(), items: nextItems }
    setLogs(existing ? logs.map(entry => entry.id === log.id ? log : entry) : [log, ...logs])
    void saveRecord('logs', log)
  }
  const changeItem = (workoutId: string, itemId: string | undefined, itemIndex: number, key: 'sets' | 'reps', amount: number) => {
    if (!viewingToday) return
    const workout = workouts.find(w => w.id === workoutId)
    const index = workout?.items.findIndex((item, index) => itemId ? item.id === itemId : index === itemIndex) ?? -1
    if (!workout || index < 0 || isItemDone(workout, workout.items[index], index)) return
    const changed = workouts.map(w => w.id === workoutId ? { ...w, items: w.items.map((item, index) => (itemId ? item.id === itemId : index === itemIndex) ? { ...item, [key]: Math.max(1, item[key] + amount) } : item) } : w); setWorkouts(changed); const updated = changed.find(w => w.id === workoutId); if (updated) void saveRecord('workouts', updated) }
  const saveExercise = () => { if (!exerciseName.trim()) return; const created = { id: uid(), name: exerciseName.trim(), load: loadType, unit }; setExercises([...exercises, created]); void saveRecord('exercises', created); setExerciseName(''); setModal(null) }
  const openLog = (log: Log) => { setEditing(log); setModal('log') }
  const saveLog = () => { if (editing) { setLogs(logs.map(l => l.id === editing.id ? editing : l)); void saveRecord('logs', editing) }; setModal(null) }
  const deleteLog = (id: string) => { setLogs(logs.filter(l => l.id !== id)); void removeRecord('logs', id); setModal(null) }
  const updateLogItem = (index: number, key: keyof Item, value: number) => { if (!editing) return; const items = editing.items.map((item, i) => i === index ? { ...item, [key]: value } : item); setEditing({ ...editing, items }) }
  const fmt = (d: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: jstTimeZone }).format(new Date(d))
  const itemSummary = (items: Item[]) => {
    if (!items.length) return 'Rest day · recovery logged'
    const grouped = new Map<string, { name: string; unit: Exercise['unit']; entries: Item[] }>()
    items.forEach(item => {
      const details = exercise(item.exerciseId)
      const group = grouped.get(item.exerciseId) ?? { name: details?.name ?? 'Exercise', unit: details?.unit ?? 'reps', entries: [] }
      group.entries.push(item)
      grouped.set(item.exerciseId, group)
    })
    return [...grouped.values()].map(group => `${group.name} (${group.entries.map(item => `${item.sets}×${item.reps}${group.unit === 'seconds' ? 's' : ''}${item.weight > 0 ? ` @ ${item.weight} kg` : ''}`).join(', ')})`).join(' · ')
  }
  const scheduleWeekStartKey = shiftDateKey(jstWeekStartKey(new Date()), scheduleWeekOffset * 7)
  const scheduleWeekEndKey = shiftDateKey(scheduleWeekStartKey, 6)
  const scheduleWeekTitle = scheduleWeekOffset === 1 ? 'Next week' : scheduleWeekOffset === 0 ? 'This week' : scheduleWeekOffset === -1 ? 'Last week' : '2 weeks ago'
  const scheduleWeekRange = `${formatWeekLabel(scheduleWeekStartKey)} – ${formatWeekLabel(scheduleWeekEndKey)}`
  const scheduleDays = weekDays.map((day, index) => {
    const dateKey = shiftDateKey(scheduleWeekStartKey, index)
    const dayDate = new Date(`${dateKey}T12:00:00+09:00`)
    const todayKey = jstDateKey(new Date())
    const isToday = dateKey === todayKey
    const isPastDay = dateKey < todayKey
    const planned = workouts.filter(workout => workout.days.includes(day))
    const dayLogs = logs.filter(log => jstDateKey(new Date(log.date)) === dateKey).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    return <div className={`day-column ${isPastDay ? 'historical-day' : ''}`} key={day}>
      <div className={`day-header ${isToday ? 'is-today' : ''}`}><span>{day}</span><small>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: jstTimeZone }).format(dayDate)}</small>{isToday && <i>Today</i>}</div>
      {isPastDay ? dayLogs.length ? dayLogs.map(log => { const iconExercise = log.items[0] ? exercise(log.items[0].exerciseId) : undefined; return <article className="schedule-card historical-log-card" key={log.id}>{iconExercise ? <ExerciseIcon exercise={iconExercise}/> : <span className="history-rest-icon">✓</span>}<strong>{log.workout}</strong><span>{log.restDay ? 'Rest day completed' : itemSummary(log.items)}</span></article> }) : <div className="historical-empty">No workout logged</div> : <>{planned.map(workout => <article className="schedule-card" key={workout.id}><WorkoutIcon workout={workout} exercises={exercises}/><strong>{workout.name}</strong><button aria-label={`Remove ${workout.name} from ${day}`} onClick={() => toggleWorkoutDay(workout, day)}>×</button></article>)}<button className="add-to-day" aria-label={`Add workout to ${day}`} title={`Add workout to ${day}`} onClick={() => openWorkout(day)}>＋</button></>}
    </div>
  })

  if (!authReady) return <div className="auth-screen"><div className="auth-brand"><span className="brand-mark">W</span><span className="brand-name">Workout Log</span></div><div className="auth-panel"><span className="sparkle">✳</span><h1>Your training, all in one place.</h1><p>Sign in to open your private workout space.</p><div className="auth-loading">Checking sign-in…</div></div></div>
  if (!user) return <div className="auth-screen"><div className="auth-brand"><span className="brand-mark">W</span><span className="brand-name">Workout Log</span></div><div className="auth-panel"><span className="sparkle">✳</span><div className="eyebrow">A SPACE JUST FOR YOU</div><h1>Your training, all in one place.</h1><p>Sign in to open your private workout space. Your workouts are only available to your account.</p><button className="google-button" disabled={authBusy} onClick={handleAuth}><span className="google-g">G</span>{authBusy ? 'Connecting to Google…' : 'Continue with Google'}<span>→</span></button>{authError && <div className="auth-error">{authError}</div>}<div className="auth-private">🔒 &nbsp;Your account is required to view any workout data.</div></div></div>
  if (!dataReady) return <div className="auth-screen"><div className="auth-brand"><span className="brand-mark">W</span><span className="brand-name">Workout Log</span></div><div className="auth-panel"><div className="eyebrow">YOUR PRIVATE WORKSPACE</div><h1>Getting your space ready.</h1><p>Loading your workouts from Firestore…</p></div></div>

  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#" onClick={e => { e.preventDefault(); navigateTab('Today') }}><span className="brand-mark">W</span><span className="brand-name">Workout Log</span></a>
      <div className="side-label">WORKSPACE</div><nav>{[['Today', '◷'], ['Schedule', '▦'], ['Exercises', '⌁'], ['All logs', '☷']].map(([name, icon]) => <button key={name} className={`nav-link ${tab === name ? 'active' : ''}`} onClick={() => navigateTab(name)}><span className="nav-icon">{icon}</span>{name}{name === 'Today' && todayWorkouts.length > 0 && <span className="nav-count">{todayWorkouts.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="coach-note"><span className="sparkle">✳</span><strong>Small steps add up.</strong><p>Show up for yourself today.</p><div className="note-line" /></div><button className="user-profile" onClick={handleAuth} disabled={authBusy}><div className="avatar">{user?.photoURL ? <img src={user.photoURL} alt="" /> : user?.displayName?.charAt(0) ?? 'G'}</div><div><strong>{authBusy ? 'Connecting…' : user?.displayName ?? 'Google sign-in'}</strong><span>{user ? 'Sign out' : 'Sign in / create account'}</span></div>{user && <span className="profile-dots">↪</span>}</button>{authError && <div className="auth-error">{authError}</div>}</div>
    </aside>
    <main className="main-content"><header className="topbar"><div className="mobile-brand"><span className="brand-mark">W</span><span className="brand-name">Workout Log</span></div><div className="breadcrumb">Workspace <span>/</span> <b>{tab}</b></div><button className="mobile-signout" onClick={handleAuth}>Sign out</button></header>
      <div className="page-wrap">{authError && <div className="auth-banner">{authError}<button onClick={() => setAuthError('')}>×</button></div>}{tab === 'Today' && <>
        <div className="greeting-row"><div><h1>{viewedDateTitle}</h1></div></div>
        <section className="today-section"><div className="section-heading"><div className="heading-actions"><div className="today-day-nav"><button aria-label="Previous day" onClick={() => setDayOffset(offset => offset - 1)}>‹</button><span>{viewingToday ? 'Today' : viewedDateLabel}</span><button aria-label="Next day" onClick={() => setDayOffset(offset => offset + 1)}>›</button>{!viewingToday && <button className="today-reset" onClick={() => setDayOffset(0)}>Today</button>}</div><button className="text-button" onClick={openManualLog}>＋ Log manually</button><button className="text-button" onClick={() => navigateTab('Schedule')}>View schedule <span>↗</span></button></div></div>
          {todayWorkouts.length ? <div className="workout-list">{todayWorkouts.map((w, wi) => <article className={`workout-card ${isWorkoutDone(w) ? 'completed' : ''}`} key={w.id}><div className="workout-top"><div className={`workout-symbol symbol-${wi % 3}`}><WorkoutIcon workout={w} exercises={exercises}/></div><div className="workout-heading"><span className="workout-category">{w.items.length} EXERCISES <i>·</i> {w.items.reduce((n, i) => n + i.sets, 0)} SETS</span><h3>{w.name}</h3></div></div><div className="workout-exercises">{w.items.map((i, idx) => { const e = exercise(i.exerciseId); return <div className="exercise-line" key={i.exerciseId + idx}><div className="exercise-info"><span className="exercise-name">{e?.name ?? 'Exercise'}</span>{i.weight > 0 && <span className="exercise-detail">{i.weight} kg</span>}</div><div className="stepper"><button disabled={!viewingToday || isItemDone(w, i, idx)} onClick={() => changeItem(w.id, i.id, idx, 'reps', -1)} aria-label="Decrease reps">−</button><span>{i.sets} × {i.reps}</span><button disabled={!viewingToday || isItemDone(w, i, idx)} onClick={() => changeItem(w.id, i.id, idx, 'reps', 1)} aria-label="Increase reps">+</button></div><label className="check-control row-check-control"><input type="checkbox" checked={isItemDone(w, i, idx)} onChange={() => completeWorkoutItem(w, i, idx)} disabled={!viewingToday} aria-label={`Log ${e?.name ?? 'exercise'}`} /><span /></label></div> })}</div>{isWorkoutDone(w) && <div className="completed-note">✓ Workout logged. Nice work.</div>}</article>)}</div> : <div className="empty-state rest-empty-state"><strong>No workout scheduled. Rest!</strong></div>}
        </section>
        <section className="upcoming-preview-section"><div className="section-heading"><div><h2>{dayOffset === 0 ? 'Coming up' : 'Next workouts'}</h2></div></div><div className="upcoming-preview-grid">{upcomingWorkoutPreviews.map(preview => <article className="upcoming-preview-card" key={preview.dayLabel}><div className="upcoming-preview-heading"><strong>{preview.title}</strong></div>{preview.workouts.length ? <div className="upcoming-preview-list">{preview.workouts.map(workout => <div className="upcoming-preview-workout" key={workout.id}><WorkoutIcon workout={workout} exercises={exercises}/><div><strong>{workout.name}</strong></div></div>)}</div> : <div className="upcoming-preview-empty">No workout scheduled</div>}</article>)}</div></section>
        <section className="recent-section"><div className="section-heading"><div><h2>Recent sessions</h2></div><button className="text-button" onClick={() => navigateTab('All logs')}>All logs <span>↗</span></button></div><div className="recent-list">{recent.length ? recent.map(log => <button className="recent-row" key={log.id} onClick={() => openLog(log)}><div className="recent-date"><strong>{fmt(log.date).split(' ')[1]}</strong><span>{fmt(log.date).split(' ')[0].toUpperCase()}</span></div><div className="recent-info"><strong>{log.workout}</strong><span>{itemSummary(log.items)}</span></div><span className="recent-volume">{log.restDay ? 'Recovery' : `${log.items.reduce((s, i) => s + i.sets, 0)} sets`}</span><span className="chevron">›</span></button>) : <div className="empty-small">Your completed workouts will show up here.</div>}</div></section>
      </>}
      {tab === 'Schedule' && <><div className="page-intro schedule-intro"><h1>Your schedule</h1><div className="schedule-week-switcher"><button type="button" aria-label="Previous week" disabled={scheduleWeekOffset <= -2} onClick={() => setScheduleWeekOffset(value => Math.max(-2, value - 1))}>‹</button><div><strong>{scheduleWeekTitle}</strong><span>{scheduleWeekRange}</span></div><button type="button" aria-label="Next week" disabled={scheduleWeekOffset >= 1} onClick={() => setScheduleWeekOffset(value => Math.min(1, value + 1))}>›</button></div></div><div className="schedule-grid">{scheduleDays}</div>{scheduleWeekOffset >= 0 && <section className="schedule-library"><div className="section-heading"><div><div className="section-kicker">WORKOUT UNITS</div><h2>Your workouts</h2></div><button className="text-button" onClick={() => openWorkout()}>＋ Create workout</button></div>{workouts.length ? <div className="schedule-workout-list">{workouts.map(workout => <article className="schedule-workout-row" key={workout.id}><WorkoutIcon workout={workout} exercises={exercises}/><div className="schedule-workout-info"><strong>{workout.name}</strong><span>{workout.items.length} exercises · {workout.items.reduce((n, item) => n + item.sets, 0)} sets</span><div className="weekday-assignments">{weekDays.map(day => <button key={day} className={workout.days.includes(day) ? 'assigned' : ''} onClick={() => toggleWorkoutDay(workout, day)} aria-label={`${workout.days.includes(day) ? 'Remove' : 'Schedule'} ${workout.name} ${day}`}>{day}</button>)}</div></div><div className="schedule-workout-actions"><button className="edit-workout-button" onClick={() => openEditWorkout(workout)}>Edit</button><button className="delete-exercise" onClick={() => { setWorkouts(workouts.filter(w => w.id !== workout.id)); void removeRecord('workouts', workout.id) }} aria-label={`Delete workout ${workout.name}`}>×</button></div></article>)}</div> : <div className="empty-small">Create a workout here, then assign it to one or more weekdays.</div>}</section>}</>}
      {tab === 'Exercises' && <><div className="page-intro exercises-intro"><h1>Exercises<span className="title-period">.</span></h1></div><section className="progress-section"><div className="section-heading"><div><div className="section-kicker">TRAINING PROGRESS</div><h2>Favorite progress</h2></div><span className="progress-period">Last 12 weeks</span></div>{favoriteExercises.length ? <div className="progress-charts">{repsSeries.length ? <ProgressChart title="Number of reps per week" unit="reps" series={repsSeries}/> : <div className="empty-small">Star exercises with rep logs to see weekly reps here.</div>}{favoriteExercises.some(item => item.load !== 'bodyweight') ? weightSeries.length ? <ProgressChart title="Max weight per week" unit="kg" series={weightSeries}/> : <div className="empty-small">No recent weighted exercise logs to chart.</div> : <div className="empty-small">Star a weighted exercise to see weekly max weight here.</div>}</div> : <div className="empty-small">Star exercises in the library below to see their weekly progress here.</div>}</section><div className="exercise-library-toolbar"><p>Browse the shared catalog or add your own exercises.</p><label className="exercise-search-label"><span>SEARCH EXERCISES</span><input type="search" placeholder="Search by exercise name" value={exerciseSearch} onChange={event => setExerciseSearch(event.target.value)}/></label><button className="button-primary" onClick={() => setModal('exercise')}>＋ Add exercise</button></div><div className="library-list">{filteredFavorites.length > 0 && <><div className="exercise-group-title">FAVORITES · {filteredFavorites.length}</div>{filteredFavorites.map(e => <div className="library-row" key={e.id}><ExerciseIcon exercise={e}/><div className="library-info"><strong>{e.name}</strong><span>{exerciseCatalog.some(item => item.id === e.id) ? 'Shared catalog · ' : ''}{e.category ?? (e.load === 'bodyweight' ? 'Bodyweight' : e.load === 'weighted' ? 'Bodyweight + weight' : 'Absolute weight')} <i>·</i> {e.unit === 'reps' ? 'Reps' : 'Seconds'}</span></div><button type="button" className="favorite-toggle is-favorite" aria-label={'Remove ' + e.name + ' from progress favorites'} aria-pressed="true" onClick={() => toggleProgressFavorite(e.id)}>★</button>{!exerciseCatalog.some(item => item.id === e.id) && <button className="delete-exercise" onClick={() => { setExercises(exercises.filter(x => x.id !== e.id)); void removeRecord('exercises', e.id) }} aria-label={'Delete ' + e.name}>×</button>}</div>)}</>}<div className="exercise-group-title">SHARED CATALOG · {filteredCatalog.length}</div>{filteredCatalog.map(e => <div className="library-row" key={e.id}><ExerciseIcon exercise={e}/><div className="library-info"><strong>{e.name}</strong><span>{e.category} <i>·</i> {e.load === 'bodyweight' ? 'Bodyweight' : e.load === 'weighted' ? 'Bodyweight + weight' : 'Absolute weight'} <i>·</i> {e.unit === 'reps' ? 'Reps' : 'Seconds'}</span></div><button type="button" className={`favorite-toggle ${progressFavorites.includes(e.id) ? 'is-favorite' : ''}`} aria-label={`${progressFavorites.includes(e.id) ? 'Remove' : 'Add'} ${e.name} ${progressFavorites.includes(e.id) ? 'from' : 'to'} progress favorites`} aria-pressed={progressFavorites.includes(e.id)} onClick={() => toggleProgressFavorite(e.id)}>{progressFavorites.includes(e.id) ? '★' : '☆'}</button><span className="catalog-badge">SHARED</span></div>)}<div className="exercise-group-title personal-exercise-title">YOUR EXERCISES · {filteredExercises.length}</div>{filteredExercises.map(e => <div className="library-row" key={e.id}><ExerciseIcon exercise={e}/><div className="library-info"><strong>{e.name}</strong><span>{e.load === 'bodyweight' ? 'Bodyweight' : e.load === 'weighted' ? 'Bodyweight + weight' : 'Absolute weight'} <i>·</i> {e.unit === 'reps' ? 'Reps' : 'Seconds'}</span></div><button type="button" className={`favorite-toggle ${progressFavorites.includes(e.id) ? 'is-favorite' : ''}`} aria-label={`${progressFavorites.includes(e.id) ? 'Remove' : 'Add'} ${e.name} ${progressFavorites.includes(e.id) ? 'from' : 'to'} progress favorites`} aria-pressed={progressFavorites.includes(e.id)} onClick={() => toggleProgressFavorite(e.id)}>{progressFavorites.includes(e.id) ? '★' : '☆'}</button><button className="delete-exercise" onClick={() => { setExercises(exercises.filter(x => x.id !== e.id)); void removeRecord('exercises', e.id) }} aria-label={`Delete ${e.name}`}>×</button></div>)}</div></>}      {tab === 'All logs' && <>
        <div className="page-intro log-intro"><div className="eyebrow">EVERY REP COUNTS</div><h1>Workout logs<span className="title-period">.</span></h1><p>A record of showing up for yourself.</p><button className="button-primary" onClick={() => openWorkout()}>＋ Log a workout</button></div>
        <div className="log-toolbar"><label className="filter-label">FILTER BY EXERCISE<select value={selected} onChange={e => { setSelected(e.target.value); setPage(1) }}><option value="all">All exercises</option>{allExercises.map(e => <option value={e.id} key={e.id}>{e.name}</option>)}</select></label><div className="log-toolbar-actions"><span className="result-count">{groupLogsByDay ? `${filtered.length} ${filtered.length === 1 ? 'session' : 'sessions'}` : `${flatRows.length} exercise entries`}</span><button className="text-button" onClick={() => { setGroupLogsByDay(!groupLogsByDay); setPage(1) }}>{groupLogsByDay ? 'Show exercises' : 'Group by day'}</button><button className="text-button" onClick={openExport}>Export CSV</button><button className="text-button" onClick={openImport}>Import CSV</button>{localToolsEnabled && <button className="text-button erase-logs-button" onClick={() => void eraseAllLogs()}>Erase logs</button>}</div></div>
        {groupLogsByDay ? <div className="all-logs">{paged.map((log, index) => { const dayKey = jstDateKey(new Date(log.date)); const previousDay = index > 0 ? jstDateKey(new Date(paged[index - 1].date)) : ''; return <div className="log-group" key={log.id}>{dayKey !== previousDay && <div className="log-day-heading">{new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: jstTimeZone }).format(new Date(log.date))}</div>}<button className="log-row" onClick={() => openLog(log)}><div className="log-date"><strong>{new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: jstTimeZone }).format(new Date(log.date))}</strong><span>{new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: jstTimeZone }).format(new Date(log.date))}</span></div><div className="log-main"><strong>{log.workout}</strong><span>{itemSummary(log.items)}</span></div><span className="log-sets">{log.restDay ? 'Recovery' : `${log.items.reduce((total, item) => total + item.sets, 0)} sets`}</span><span className="chevron">›</span></button></div>})}</div> : <div className="all-logs">{pagedFlatRows.map(({ log, item }, index) => <button className="log-row" key={`${log.id}-${item?.id ?? index}`} onClick={() => openLog(log)}><div className="log-date"><strong>{new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: jstTimeZone }).format(new Date(log.date))}</strong><span>{new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: jstTimeZone }).format(new Date(log.date))}</span></div><div className="log-main"><strong>{item ? exercise(item.exerciseId)?.name ?? 'Exercise' : log.workout}</strong><span>{item ? `${item.sets}×${item.reps}${exercise(item.exerciseId)?.unit === 'seconds' ? 's' : ''}${item.weight > 0 ? ` @ ${item.weight} kg` : ''} · ${log.workout}` : itemSummary(log.items)}</span></div><span className="log-sets">{item ? `${item.sets} sets` : log.restDay ? 'Recovery' : `${log.items.reduce((total, entry) => total + entry.sets, 0)} sets`}</span><span className="chevron">›</span></button>)}</div>}
        {!(groupLogsByDay ? paged.length : pagedFlatRows.length) && <div className="empty-small">No sessions match this exercise yet.</div>}
        <div className="pagination"><span>Showing {displayedCount ? (page - 1) * 20 + 1 : 0}–{Math.min(page * 20, displayedCount)} of {displayedCount}</span><div><button disabled={page === 1} onClick={() => setPage(page - 1)}>←</button><span>{page} / {Math.max(1, Math.ceil(displayedCount / 20))}</span><button disabled={page >= Math.ceil(displayedCount / 20)} onClick={() => setPage(page + 1)}>→</button></div></div>
      </>}
      </div>
      <nav className="mobile-nav">{[['Today','◷'],['Schedule','▦'],['Exercises','⌁'],['All logs','☷']].map(([name,icon])=><button key={name} className={tab===name?'active':''} onClick={()=>navigateTab(name)}><span>{icon}</span>{name}</button>)}</nav>
    </main>
    {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) { setModal(null); setEditingWorkout(null) } }}><div className="modal-card"><div className="modal-top"><div><div className="eyebrow">{modal === 'exercise' ? 'MOVEMENT LIBRARY' : modal === 'workout' ? 'MAKE A PLAN' : modal === 'workout-edit' ? 'WORKOUT UNIT' : modal === 'manual' ? 'LOG A SESSION' : modal === 'import' ? 'BATCH IMPORT' : modal === 'export' ? 'EXPORT WORKOUTS' : editing?.restDay ? 'RECOVERY' : 'SESSION DETAILS'}</div><h2>{modal === 'exercise' ? 'Add an exercise' : modal === 'workout' ? 'Create a workout' : modal === 'workout-edit' ? 'Edit workout' : modal === 'manual' ? 'Log a workout' : modal === 'import' ? 'Import past workouts' : modal === 'export' ? 'Export CSV' : editing?.restDay ? 'Rest day check-in' : 'Edit session'}</h2></div><button className="modal-close" onClick={() => { setModal(null); setEditingWorkout(null) }}>×</button></div>
      {modal === 'exercise' && <div className="form-stack"><label>Exercise name<input placeholder="e.g. Goblet squat" value={exerciseName} onChange={e => setExerciseName(e.target.value)} /></label><label>Weight type<select value={loadType} onChange={e => setLoadType(e.target.value as Exercise['load'])}><option value="absolute">Absolute weight</option><option value="bodyweight">Bodyweight</option><option value="weighted">Bodyweight + added weight</option></select></label><label>How do you count it?<select value={unit} onChange={e => setUnit(e.target.value as Exercise['unit'])}><option value="reps">Reps</option><option value="seconds">Seconds</option></select></label><button className="button-primary full-button" onClick={saveExercise}>Save exercise <span>→</span></button></div>}
      {modal === 'export' && <div className="form-stack export-form"><p className="import-instructions">Choose which workout dates to include. Leave either date blank for an open-ended range.</p><label>Start date (optional)<input type="date" value={exportStartDate} onChange={e => setExportStartDate(e.target.value)} /></label><label>End date (optional)<input type="date" value={exportEndDate} onChange={e => setExportEndDate(e.target.value)} /></label>{exportStartDate && exportEndDate && exportEndDate < exportStartDate && <div className="import-errors">End date must be on or after the start date.</div>}<button className="button-primary full-button" disabled={Boolean(exportStartDate && exportEndDate && exportEndDate < exportStartDate)} onClick={exportLogsCsv}>Download CSV <span>↓</span></button></div>}
      {modal === 'import' && <div className="form-stack import-form"><p className="import-instructions">Import a CSV with Date, Exercise Name, and Reps (or Count). Workout Name, Sets, and Weight are optional; files with one row per set are supported. Rows without a workout name are grouped by date and named after the first exercise. Exercise names must match your library.</p><button type="button" className="template-button" onClick={downloadCsvTemplate}>↓ Download CSV template</button><label className="file-picker">Choose a CSV file<input type="file" accept=".csv,text/csv" onChange={e => void readImportFile(e.target.files?.[0])}/></label>{importFileName && <div className="import-file-name">Selected: {importFileName}</div>}{importErrors.length > 0 && <div className="import-errors"><strong>Fix these rows before importing:</strong><ul>{importErrors.slice(0, 8).map((error, index) => <li key={index}>{error}</li>)}</ul>{importErrors.length > 8 && <span>And {importErrors.length - 8} more issues.</span>}</div>}{!importErrors.length && importLogs.length > 0 && <div className="import-preview"><strong>Ready to import</strong><span>{importLogs.length} workout logs · {importLogs.reduce((n, log) => n + log.items.length, 0)} exercise entries</span></div>}<button className="button-primary full-button" disabled={!importLogs.length || importErrors.length > 0} onClick={() => void saveImportedLogs()}>Import workouts <span>→</span></button></div>}
      {modal === 'manual' && <div className="form-stack"><label>Workout name<input placeholder="e.g. Quick evening session" value={workoutName} onChange={e => setWorkoutName(e.target.value)} /></label><div className="form-divider">EXERCISES COMPLETED</div>{workoutItems.map((item, idx) => <div className="workout-form-item" key={idx}><select value={item.exerciseId} onChange={e => setWorkoutItems(workoutItems.map((it, n) => n === idx ? {...it, exerciseId:e.target.value} : it))}>{allExercises.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}</select><NumericInput aria-label="Sets" min={1} value={item.sets} onValueChange={value=>setWorkoutItems(workoutItems.map((it,n)=>n===idx?{...it,sets:value}:it))}/><span>sets ×</span><NumericInput aria-label="Reps or seconds" min={1} value={item.reps} onValueChange={value=>setWorkoutItems(workoutItems.map((it,n)=>n===idx?{...it,reps:value}:it))}/><span>{exercise(item.exerciseId)?.unit === 'seconds' ? 'sec' : 'reps'}</span><NumericInput className="weight-input" aria-label="Weight in kilograms, optional" min={0} step={0.5} placeholder="kg" value={item.weight} emptyAsBlank onValueChange={value=>setWorkoutItems(workoutItems.map((it,n)=>n===idx?{...it,weight:value}:it))}/><button aria-label="Remove exercise" onClick={()=>setWorkoutItems(workoutItems.filter((_,n)=>n!==idx))}>×</button></div>)}{allExercises.length ? <button className="add-exercise-line" onClick={()=>setWorkoutItems([...workoutItems,{exerciseId:allExercises[0].id,sets:3,reps:10,weight:0}])}>＋ Add exercise</button> : <button className="add-exercise-line" onClick={()=>setModal('exercise')}>＋ Create an exercise first</button>}<button className="button-primary full-button" disabled={!allExercises.length || !workoutItems.length || !workoutName.trim()} onClick={saveManualLog}>Save to logs <span>→</span></button></div>}
      {(modal === 'workout' || modal === 'workout-edit') && <div className="form-stack"><label>Workout name<input placeholder="e.g. Upper body strength" value={workoutName} onChange={e => setWorkoutName(e.target.value)} /></label><div className="form-divider">SCHEDULE ON</div><div className="weekday-picker">{weekDays.map(day => <label key={day} className={`weekday-option ${workoutDays.includes(day) ? 'assigned' : ''}`}><input type="checkbox" checked={workoutDays.includes(day)} onChange={() => setWorkoutDays(workoutDays.includes(day) ? workoutDays.filter(d => d !== day) : [...workoutDays, day])}/><span>{day}</span></label>)}</div><span className="form-hint">Choose one or more days, or leave them all unchecked for an unscheduled workout.</span><div className="form-divider">EXERCISES IN THIS WORKOUT</div>{workoutItems.map((item, idx) => <div className="workout-form-item" key={idx}><div className="reorder-controls"><button disabled={idx === 0} aria-label={`Move ${exercise(item.exerciseId)?.name ?? 'exercise'} up`} onClick={() => moveWorkoutItem(idx, -1)}>↑</button><button disabled={idx === workoutItems.length - 1} aria-label={`Move ${exercise(item.exerciseId)?.name ?? 'exercise'} down`} onClick={() => moveWorkoutItem(idx, 1)}>↓</button></div><select value={item.exerciseId} onChange={e => setWorkoutItems(workoutItems.map((it, n) => n === idx ? {...it, exerciseId:e.target.value} : it))}>{allExercises.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}</select><NumericInput aria-label="Sets" min={1} value={item.sets} onValueChange={value=>setWorkoutItems(workoutItems.map((it,n)=>n===idx?{...it,sets:value}:it))}/><span>sets ×</span><NumericInput aria-label="Reps or seconds" min={1} value={item.reps} onValueChange={value=>setWorkoutItems(workoutItems.map((it,n)=>n===idx?{...it,reps:value}:it))}/><span>{exercise(item.exerciseId)?.unit === 'seconds' ? 'sec' : 'reps'}</span><NumericInput className="weight-input" aria-label="Weight in kilograms, optional" min={0} step={0.5} placeholder="kg" value={item.weight} emptyAsBlank onValueChange={value=>setWorkoutItems(workoutItems.map((it,n)=>n===idx?{...it,weight:value}:it))}/><button type="button" title="Remove exercise" aria-label={`Remove ${exercise(item.exerciseId)?.name ?? 'exercise'}`} onClick={()=>setWorkoutItems(workoutItems.filter((_,n)=>n!==idx))}>×</button></div>)}<div className="workout-icon-picker"><div className="form-divider">WORKOUT ICON <span>· defaults to the first exercise</span></div><div className="workout-icon-options">{[...new Map(workoutItems.map(item => [item.exerciseId, item])).values()].map(item => { const iconExercise = exercise(item.exerciseId); if (!iconExercise) return null; return <button type="button" key={item.exerciseId} className={(workoutIconExerciseId || workoutItems[0]?.exerciseId) === item.exerciseId ? 'selected' : ''} aria-label={`Use ${iconExercise.name} icon`} aria-pressed={(workoutIconExerciseId || workoutItems[0]?.exerciseId) === item.exerciseId} title={iconExercise.name} onClick={() => setWorkoutIconExerciseId(workoutIconExerciseId === item.exerciseId ? '' : item.exerciseId)}><ExerciseIcon exercise={iconExercise}/></button>})}</div></div><button className="add-exercise-line" disabled={!allExercises.length} onClick={()=>setWorkoutItems([...workoutItems,{exerciseId:allExercises[0]?.id??'',sets:3,reps:10,weight:0}])}>＋ Add exercise</button><button className="button-primary full-button" disabled={!allExercises.length || !workoutItems.length || !workoutName.trim()} onClick={saveWorkout}>{modal === 'workout-edit' ? 'Save workout changes' : 'Save workout'} <span>→</span></button></div>}
      {modal === 'log' && editing && (editing.restDay ? <div className="form-stack"><p className="rest-log-copy">You marked {fmt(editing.date)} as a completed rest day.</p><div className="modal-footer"><button className="delete-log-button" onClick={()=>deleteLog(editing.id)}>Remove completion</button><button className="button-primary" onClick={()=>setModal(null)}>Done</button></div></div> : <div className="form-stack"><label>Workout name<input value={editing.workout} onChange={e=>setEditing({...editing,workout:e.target.value})}/></label><div className="form-divider">EXERCISES · {fmt(editing.date)}</div>{editing.items.map((item,idx)=><div className="edit-log-item" key={idx}><div className="edit-log-item-top"><strong>{exercise(item.exerciseId)?.name ?? 'Exercise'}</strong><button type="button" className="remove-log-exercise" onClick={()=>setEditing({...editing,items:editing.items.filter((_,i)=>i!==idx)})}>Remove</button></div><div className="edit-log-fields"><label>Sets<input type="number" min="1" value={item.sets} onChange={e=>updateLogItem(idx,'sets',+e.target.value)}/></label><label>{exercise(item.exerciseId)?.unit === 'seconds' ? 'Seconds' : 'Reps'}<input type="number" min="1" value={item.reps} onChange={e=>updateLogItem(idx,'reps',+e.target.value)}/></label>{item.weight>0&&<label>Weight<input type="number" value={item.weight} onChange={e=>updateLogItem(idx,'weight',+e.target.value)}/></label>}</div></div>)}<div className="modal-footer"><button className="delete-log-button" onClick={()=>deleteLog(editing.id)}>Delete session</button><button className="button-primary" onClick={saveLog}>Save changes</button></div></div>)}
    </div></div>}
  </div>
}
export default App
